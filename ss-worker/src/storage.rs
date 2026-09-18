//! Onde os filmes ficam: os lugares que a instalação autoriza, e nada além.
//!
//! A página não escolhe um caminho, escolhe um rótulo de uma lista que o worker
//! publicou. A diferença é tudo: aceitar um caminho vindo do navegador seria
//! entregar escrita em qualquer lugar do disco a quem abrisse uma sala. A lista
//! vem do ambiente, que é de quem instalou; a escolha vem da página, que é de
//! quem assiste.
//!
//! `SS_WORKER_STORAGE_DIRS=SSD=/mnt/ssd/juntos,HDD=/mnt/hdd/juntos`. Vazio, o
//! único lugar é o data dir, que é o comportamento que sempre existiu.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use serde::Serialize;

/// O rótulo do lugar que o worker usa quando ninguém escolhe.
pub const DEFAULT_LABEL: &str = "default";

const MAX_LABEL: usize = 32;
const MAX_PLACES: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Place {
    /// Como a página chama este lugar. É o que trafega, nunca o caminho.
    pub label: String,
    #[serde(skip)]
    pub path: PathBuf,
}

/// Um lugar como a página o vê: o rótulo e quanto ainda cabe. O caminho não
/// sai daqui — quem assiste escolhe entre "SSD" e "HDD", não entre diretórios,
/// e publicar a árvore de diretórios do worker não ajudaria ninguém.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PlaceReport {
    pub label: String,
    #[serde(rename = "freeBytes")]
    pub free_bytes: u64,
}

/// Os lugares desta instalação, na ordem em que foram configurados. Nunca
/// vazia: sem configuração nenhuma, o data dir é o lugar.
#[derive(Clone, Debug)]
pub struct Places(Vec<Place>);

impl Places {
    /// Lê a lista do ambiente. Um erro aqui derruba a subida de propósito: um
    /// worker que silenciosamente ignora onde lhe mandaram guardar os filmes é
    /// pior do que um worker que não sobe.
    pub fn parse(raw: Option<&str>, data_dir: &Path) -> anyhow::Result<Self> {
        let raw = raw.map(str::trim).unwrap_or_default();
        if raw.is_empty() {
            return Ok(Self(vec![Place {
                label: DEFAULT_LABEL.into(),
                path: data_dir.join("torrents"),
            }]));
        }
        let mut places: Vec<Place> = Vec::new();
        for piece in raw.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let (label, path) = piece
                .split_once('=')
                .with_context(|| format!("SS_WORKER_STORAGE_DIRS: `{piece}` is not label=path"))?;
            let (label, path) = (label.trim(), Path::new(path.trim()));
            if !valid_label(label) {
                bail!("SS_WORKER_STORAGE_DIRS: `{label}` is not a usable label (letters, digits, space, dash and underscore, up to {MAX_LABEL})");
            }
            if !path.is_absolute() {
                bail!("SS_WORKER_STORAGE_DIRS: `{}` must be an absolute path", path.display());
            }
            if places.iter().any(|held| held.label.eq_ignore_ascii_case(label)) {
                bail!("SS_WORKER_STORAGE_DIRS: `{label}` appears twice");
            }
            places.push(Place { label: label.to_string(), path: path.to_path_buf() });
        }
        if places.is_empty() {
            bail!("SS_WORKER_STORAGE_DIRS is set but names no place");
        }
        if places.len() > MAX_PLACES {
            bail!("SS_WORKER_STORAGE_DIRS names more than {MAX_PLACES} places");
        }
        Ok(Self(places))
    }

    /// Cria o que falta. Um lugar que não pode ser criado derruba a subida,
    /// porque descobri-lo no meio de um download é descobri-lo tarde demais.
    pub fn ensure(&self) -> anyhow::Result<()> {
        for place in &self.0 {
            std::fs::create_dir_all(&place.path)
                .with_context(|| format!("storage place `{}` at {}", place.label, place.path.display()))?;
        }
        Ok(())
    }

    /// Onde um torrent sem escolha vai parar.
    pub fn default_path(&self) -> &Path {
        &self.0[0].path
    }

    /// Resolve um rótulo. `None` para um que não existe, para o chamador
    /// decidir entre recusar e cair no padrão — são decisões diferentes.
    pub fn resolve(&self, label: &str) -> Option<&Path> {
        let label = label.trim();
        if label.is_empty() {
            return Some(self.default_path());
        }
        self.0
            .iter()
            .find(|place| place.label.eq_ignore_ascii_case(label))
            .map(|place| place.path.as_path())
    }

    pub fn all(&self) -> &[Place] {
        &self.0
    }

    /// Todos os caminhos, que é o que a contabilidade de disco precisa varrer.
    pub fn paths(&self) -> Vec<PathBuf> {
        self.all().iter().map(|place| place.path.clone()).collect()
    }

    /// O que vai no heartbeat. Um lugar cujo espaço não dá para medir é
    /// publicado com zero em vez de omitido: sumir da lista tiraria da pessoa
    /// um disco que existe e funciona.
    pub fn report(&self) -> Vec<PlaceReport> {
        self.all()
            .iter()
            .map(|place| PlaceReport {
                label: place.label.clone(),
                free_bytes: free_bytes(&place.path).unwrap_or(0),
            })
            .collect()
    }
}

/// O que o filesystem sob `dir` carrega: o total e o que ainda está livre.
/// `None` quando não dá para perguntar, o que inclui um caminho que ainda não
/// existe.
// u64::from parece redundante porque nesta plataforma os campos já são u64;
// em alvos onde são mais estreitos, não são. A conversão é o que faz a mesma
// linha compilar nos dois.
#[allow(clippy::useless_conversion)]
#[cfg(unix)]
pub fn filesystem(dir: &Path) -> Option<(u64, u64)> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: um caminho terminado em nul e uma struct própria para preencher.
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    let block = u64::from(stat.f_frsize);
    Some((u64::from(stat.f_blocks) * block, u64::from(stat.f_bavail) * block))
}

#[cfg(not(unix))]
pub fn filesystem(_dir: &Path) -> Option<(u64, u64)> {
    None
}

fn free_bytes(dir: &Path) -> Option<u64> {
    filesystem(dir).map(|(_, free)| free)
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_LABEL
        && label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_configuration_means_the_data_dir_and_nothing_else() {
        let places = Places::parse(None, Path::new("/srv/ss")).unwrap();

        assert_eq!(places.all().len(), 1);
        assert_eq!(places.all()[0].label, DEFAULT_LABEL);
        assert_eq!(places.default_path(), Path::new("/srv/ss/torrents"));
    }

    #[test]
    fn a_blank_setting_reads_as_no_configuration() {
        for raw in ["", "   "] {
            let places = Places::parse(Some(raw), Path::new("/srv/ss")).unwrap();
            assert_eq!(places.all().len(), 1, "{raw:?}");
        }
    }

    // Uma configuração escrita e que não nomeia lugar nenhum é um engano de
    // quem instalou, não um pedido para usar o padrão.
    #[test]
    fn a_setting_that_names_no_place_is_refused() {
        assert!(Places::parse(Some(","), Path::new("/srv/ss")).is_err());
    }

    #[test]
    fn labels_map_to_their_paths_whatever_case_they_are_asked_in() {
        let places = Places::parse(Some("SSD=/mnt/ssd, HDD = /mnt/hdd"), Path::new("/srv/ss")).unwrap();

        assert_eq!(places.resolve("ssd"), Some(Path::new("/mnt/ssd")));
        assert_eq!(places.resolve("HDD"), Some(Path::new("/mnt/hdd")));
        // Sem escolha é o primeiro da lista, não um erro.
        assert_eq!(places.resolve(""), Some(Path::new("/mnt/ssd")));
        assert_eq!(places.default_path(), Path::new("/mnt/ssd"));
    }

    #[test]
    fn an_unknown_label_resolves_to_nothing_rather_than_to_the_default() {
        let places = Places::parse(Some("SSD=/mnt/ssd"), Path::new("/srv/ss")).unwrap();

        assert_eq!(places.resolve("HDD"), None);
    }

    // Um caminho relativo dependeria do diretório de trabalho do processo, que
    // ninguém que escreve a configuração tem como prever.
    #[test]
    fn a_relative_path_is_refused() {
        assert!(Places::parse(Some("SSD=data/ssd"), Path::new("/srv/ss")).is_err());
    }

    #[test]
    fn a_label_that_could_be_anything_else_is_refused() {
        for raw in [
            "../etc=/mnt/ssd",
            "a/b=/mnt/ssd",
            "=/mnt/ssd",
            "SSD",
            "a\nb=/mnt/ssd",
        ] {
            assert!(Places::parse(Some(raw), Path::new("/srv/ss")).is_err(), "{raw:?}");
        }
    }

    #[test]
    fn the_same_label_twice_is_refused_however_it_is_spelled() {
        assert!(Places::parse(Some("SSD=/mnt/a,ssd=/mnt/b"), Path::new("/srv/ss")).is_err());
    }

    #[test]
    fn a_label_longer_than_the_limit_is_refused() {
        let long = "x".repeat(MAX_LABEL + 1);
        assert!(Places::parse(Some(&format!("{long}=/mnt/ssd")), Path::new("/srv/ss")).is_err());
    }

    #[test]
    fn more_places_than_the_limit_are_refused() {
        let raw = (0..=MAX_PLACES)
            .map(|n| format!("d{n}=/mnt/d{n}"))
            .collect::<Vec<_>>()
            .join(",");
        assert!(Places::parse(Some(&raw), Path::new("/srv/ss")).is_err());
    }

    #[test]
    fn only_the_label_is_ever_published() {
        let places = Places::parse(Some("SSD=/mnt/secret-path"), Path::new("/srv/ss")).unwrap();
        let json = serde_json::to_string(places.all()).unwrap();

        assert!(json.contains("SSD"));
        assert!(!json.contains("secret-path"), "{json}");
    }
}
