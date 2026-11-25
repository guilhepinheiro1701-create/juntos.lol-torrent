//! A ficha (.torrent) de cada torrent ja aberto, guardada em
//! `<data_dir>/metainfo/<infohash>.torrent`.
//!
//! Um link magnet so traz o hash: a lista de arquivos e de pedacos vem dos
//! peers. Guardando a ficha na primeira vez, abrir de novo (e principalmente
//! abrir um filme ja baixado depois de reiniciar o worker) nao depende do
//! enxame responder. Sao uns poucos KB por torrent.

use std::path::{Path, PathBuf};

fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("metainfo")
}

fn path(data_dir: &Path, infohash: &str) -> Option<PathBuf> {
    // So hash de verdade vira nome de arquivo.
    if infohash.len() != 40 || !infohash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(dir(data_dir).join(format!("{}.torrent", infohash.to_ascii_lowercase())))
}

pub fn load(data_dir: &Path, infohash: &str) -> Option<Vec<u8>> {
    let bytes = std::fs::read(path(data_dir, infohash)?).ok()?;
    // Uma ficha corrompida (gravacao interrompida) nao pode travar o torrent:
    // sem o comeco de um dicionario bencode, e como se nao existisse.
    if bytes.first() != Some(&b'd') {
        return None;
    }
    Some(bytes)
}

pub fn save(data_dir: &Path, infohash: &str, bytes: &[u8]) {
    let Some(target) = path(data_dir, infohash) else { return };
    if bytes.is_empty() || bytes.len() > 32 * 1024 * 1024 {
        return;
    }
    if std::fs::create_dir_all(dir(data_dir)).is_err() {
        return;
    }
    // Grava ao lado e renomeia: quem le nunca ve meio arquivo.
    let tmp = target.with_extension("part");
    if std::fs::write(&tmp, bytes).is_ok() && std::fs::rename(&tmp, &target).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_guards() {
        let dir = std::env::temp_dir().join(format!("ss-meta-{}", std::process::id()));
        let hash = "00cc9081feed68eef9a8893368f9e198f0204483";
        assert!(load(&dir, hash).is_none());
        save(&dir, hash, b"d4:infod4:name1:xee");
        assert_eq!(load(&dir, hash).as_deref(), Some(&b"d4:infod4:name1:xee"[..]));
        assert_eq!(load(&dir, &hash.to_uppercase()).as_deref(), Some(&b"d4:infod4:name1:xee"[..]));
        save(&dir, "../../etc/passwd", b"d1:ae");
        assert!(path(&dir, "../../etc/passwd").is_none());
        std::fs::write(path(&dir, hash).unwrap(), b"garbage").unwrap();
        assert!(load(&dir, hash).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
