//! O que foi guardado para assistir offline, num arquivo que sobrevive ao
//! processo.
//!
//! Sem isto o `keep` vive só na memória do worker, e o worker apaga
//! `<data_dir>/torrents` inteiro ao subir — o que torna "baixar para assistir
//! offline" verdade até o primeiro restart e mentira depois dele. O registro
//! aqui responde duas perguntas na subida: quais pastas não devem ser varridas,
//! e quais torrents voltam marcados quando forem readicionados.
//!
//! Guarda a pasta e não só o infohash porque a librqbit nomeia a pasta de saída
//! pelo nome do torrent, não pelo hash: sem esse mapa não há como poupar uma
//! pasta sem saber a qual torrent ela pertence.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

const FILE: &str = "kept.json";

#[derive(Serialize, Deserialize, Default)]
struct Disk {
    /// infohash em minúsculas -> pasta de saída daquele torrent.
    kept: HashMap<String, PathBuf>,
}

pub struct Kept {
    path: PathBuf,
    map: Mutex<HashMap<String, PathBuf>>,
}

impl Kept {
    /// Lê o registro. Um arquivo ausente, vazio ou corrompido é um registro
    /// vazio: perder a marca custa espaço em disco, e recusar-se a subir por
    /// causa dela custaria o worker inteiro.
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join(FILE);
        let map = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Disk>(&bytes).ok())
            .map(|disk| disk.kept)
            .unwrap_or_default();
        if !map.is_empty() {
            tracing::info!(count = map.len(), "kept torrents carried over from the last run");
        }
        Self { path, map: Mutex::new(map) }
    }

    pub fn contains(&self, infohash: &str) -> bool {
        self.map.lock().contains_key(&infohash.to_ascii_lowercase())
    }

    /// As pastas que a varredura de subida deve poupar.
    pub fn folders(&self) -> Vec<PathBuf> {
        self.map.lock().values().cloned().collect()
    }

    pub fn mark(&self, infohash: &str, folder: PathBuf) {
        self.map.lock().insert(infohash.to_ascii_lowercase(), folder);
        self.save();
    }

    pub fn clear(&self, infohash: &str) {
        self.map.lock().remove(&infohash.to_ascii_lowercase());
        self.save();
    }

    /// Esquece o que já não existe no disco, para o registro não crescer com
    /// promessas que ninguém pode cumprir.
    pub fn prune_missing(&self) {
        let dropped = {
            let mut map = self.map.lock();
            let before = map.len();
            map.retain(|_, folder| folder.exists());
            before - map.len()
        };
        if dropped > 0 {
            tracing::info!(dropped, "kept torrents whose files are gone");
            self.save();
        }
    }

    /// Escreve por arquivo temporário e rename, senão uma queda no meio da
    /// escrita deixaria um registro truncado — que na subida seguinte seria
    /// lido como vazio e levaria os downloads junto.
    fn save(&self) {
        let disk = Disk { kept: self.map.lock().clone() };
        let Ok(bytes) = serde_json::to_vec_pretty(&disk) else { return };
        let tmp = self.path.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, &bytes) {
            tracing::warn!(error = %e, "could not write the kept registry");
            return;
        }
        if let Err(e) = std::fs::rename(&tmp, &self.path) {
            tracing::warn!(error = %e, "could not replace the kept registry");
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

/// Limpa o que a execução anterior deixou, poupando as pastas guardadas.
///
/// A varredura antiga apagava `torrents/` inteiro. Esta apaga tudo menos o que
/// alguém pediu para ficar, que é a diferença entre um download permanente e um
/// que dura até o próximo restart.
pub fn sweep_leftovers(dir: &Path, keep: &[PathBuf]) {
    if !dir.exists() {
        return;
    }
    let keep: Vec<PathBuf> = keep
        .iter()
        .map(|path| path.canonicalize().unwrap_or_else(|_| path.clone()))
        .collect();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::warn!(dir = %dir.display(), error = %e, "could not read leftover torrent data");
            return;
        }
    };
    let (mut removed, mut spared) = (0usize, 0usize);
    for entry in entries.flatten() {
        let path = entry.path();
        let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
        if keep.contains(&canonical) {
            spared += 1;
            continue;
        }
        let outcome = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match outcome {
            Ok(()) => removed += 1,
            Err(e) => tracing::warn!(path = %path.display(), error = %e, "could not clear leftover torrent data"),
        }
    }
    tracing::info!(removed, spared, "swept torrent data left by the previous run");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Um diretório só deste teste, removido no fim. A mesma convenção do
    /// resto do worker, que não traz `tempfile` para dentro.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "ssw-kept-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("movie.mkv"), b"bytes").unwrap();
        path
    }

    #[test]
    fn a_kept_folder_survives_the_sweep_and_the_rest_does_not() {
        let root = Scratch::new();
        let torrents = root.path().join("torrents");
        std::fs::create_dir_all(&torrents).unwrap();
        let kept_dir = write(&torrents, "Duna 2021");
        let other = write(&torrents, "Something Else");

        sweep_leftovers(&torrents, std::slice::from_ref(&kept_dir));

        assert!(kept_dir.join("movie.mkv").exists());
        assert!(!other.exists());
    }

    #[test]
    fn the_registry_survives_the_process() {
        let root = Scratch::new();
        let folder = root.path().join("torrents/Duna");
        {
            let kept = Kept::load(root.path());
            assert!(!kept.contains("ABC"));
            kept.mark("ABC", folder.clone());
        }

        let reloaded = Kept::load(root.path());
        // Gravado em minúsculas, e encontrado seja como for que perguntem.
        assert!(reloaded.contains("abc"));
        assert!(reloaded.contains("ABC"));
        assert_eq!(reloaded.folders(), vec![folder]);
    }

    #[test]
    fn clearing_gives_the_folder_back_to_the_sweep() {
        let root = Scratch::new();
        let kept = Kept::load(root.path());
        kept.mark("abc", root.path().join("torrents/Duna"));
        kept.clear("ABC");

        assert!(!kept.contains("abc"));
        assert!(Kept::load(root.path()).folders().is_empty());
    }

    // Um registro truncado ou de outra versão não pode impedir o worker de
    // subir; o custo de ignorá-lo é espaço em disco, não o serviço.
    #[test]
    fn a_broken_registry_reads_as_empty() {
        for raw in [&b"{"[..], b"null", b"[]", b"{\"kept\":7}"] {
            let root = Scratch::new();
            std::fs::write(root.path().join(FILE), raw).unwrap();

            assert!(Kept::load(root.path()).folders().is_empty());
        }
    }

    #[test]
    fn pruning_forgets_folders_that_are_gone() {
        let root = Scratch::new();
        let torrents = root.path().join("torrents");
        std::fs::create_dir_all(&torrents).unwrap();
        let alive = write(&torrents, "Alive");
        let kept = Kept::load(root.path());
        kept.mark("aaa", alive.clone());
        kept.mark("bbb", torrents.join("Gone"));

        kept.prune_missing();

        assert!(kept.contains("aaa"));
        assert!(!kept.contains("bbb"));
        assert_eq!(Kept::load(root.path()).folders(), vec![alive]);
    }
}
