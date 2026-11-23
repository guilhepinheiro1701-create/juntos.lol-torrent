# Teste de rede BitTorrent, rodado pelo diagnostico.ps1 dentro da rede do
# proprio worker (docker run --network container:<worker>). So le e pergunta:
# nao baixa nada nem fica de pe.
#
# Responde cinco perguntas, que separam "o torrent esta morto" de "a rede do
# Docker nao deixa o BitTorrent passar":
#   1. UDP para trackers funciona?   2. A DHT responde?
#   3. Um torrent saudavel (Ubuntu) conecta?   4. E os tentados?   5. IPv6?
import os
import random
import socket
import struct
import sys

TRACKERS = [("tracker.opentrackr.org", 1337), ("open.stealth.si", 80), ("tracker.torrent.eu.org", 451), ("exodus.desync.com", 6969)]
DHT = [("router.bittorrent.com", 6881), ("dht.transmissionbt.com", 6881), ("router.utorrent.com", 6881)]
HASHES = [h for h in sys.argv[1:] if len(h) == 40]


def ipv4(host, port, kind):
    return socket.getaddrinfo(host, port, socket.AF_INET, kind)[0][4]


def udp_connect(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(5)
    addr = ipv4(host, port, socket.SOCK_DGRAM)
    tid = random.getrandbits(32)
    s.sendto(struct.pack(">QII", 0x41727101980, 0, tid), addr)
    data, _ = s.recvfrom(2048)
    action, rtid, cid = struct.unpack(">IIQ", data[:16])
    if action != 0 or rtid != tid:
        raise RuntimeError("resposta estranha")
    return s, addr, cid


def announce(s, addr, cid, infohash):
    tid = random.getrandbits(32)
    pkt = struct.pack(">QII20s20sQQQIIIiH", cid, 1, tid, bytes.fromhex(infohash),
                      b"-JL0001-" + os.urandom(12), 0, 1 << 30, 0, 2, 0, random.getrandbits(32), 60, 6881)
    s.sendto(pkt, addr)
    data, _ = s.recvfrom(8192)
    action, _, _, leechers, seeders = struct.unpack(">IIIII", data[:20])
    if action != 1:
        raise RuntimeError("tracker recusou")
    peers = [(socket.inet_ntoa(data[i:i + 4]), struct.unpack(">H", data[i + 4:i + 6])[0]) for i in range(20, len(data) - 5, 6)]
    return seeders, leechers, peers


def bencode_info_hash(data):
    """SHA-1 do dicionario 'info' de um .torrent, sem biblioteca: acha onde
    ele comeca e anda pelo bencode ate o fim dele."""
    import hashlib

    def end(i):
        c = data[i:i + 1]
        if c == b"i":
            return data.index(b"e", i) + 1
        if c in (b"l", b"d"):
            i += 1
            while data[i:i + 1] != b"e":
                i = end(i)
            return i + 1
        colon = data.index(b":", i)
        return colon + 1 + int(data[i:colon])

    start = data.index(b"4:info") + len(b"4:info")
    return hashlib.sha1(data[start:end(start)]).hexdigest()


def ubuntu_reference():
    """O torrent oficial do Ubuntu: legal, sempre com milhares de seeds. Serve
    de regua - se nem os peers dele conectam, o problema e a rede."""
    import re
    import urllib.request
    base = "https://releases.ubuntu.com/24.04/"
    page = urllib.request.urlopen(base, timeout=15).read().decode("utf-8", "replace")
    names = sorted(set(re.findall(r'href="(ubuntu-[^"]+-desktop-amd64\.iso\.torrent)"', page)))
    if not names:
        raise RuntimeError("nao achei o .torrent na pagina do Ubuntu")
    data = urllib.request.urlopen(base + names[-1], timeout=15).read()
    return names[-1], bencode_info_hash(data)


def section(title):
    print("")
    print("-- " + title)


section("1. UDP para trackers")
working = None
for host, port in TRACKERS:
    try:
        s, addr, cid = udp_connect(host, port)
        print("ok     %s:%d" % (host, port))
        if working is None:
            working = (s, addr, cid, host)
    except Exception as e:
        print("FALHOU %s:%d (%s)" % (host, port, e))

section("2. DHT (ping nos roteadores)")
for host, port in DHT:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(5)
        s.sendto(b"d1:ad2:id20:" + os.urandom(20) + b"e1:q4:ping1:t2:jl1:y1:qe", ipv4(host, port, socket.SOCK_DGRAM))
        data, _ = s.recvfrom(2048)
        print(("ok     %s" if b"1:y1:r" in data else "ESTRANHO %s") % host)
    except Exception as e:
        print("FALHOU %s (%s)" % (host, e))

def probe_peers(label, infohash):
    seeders, leechers, peers = announce(s, addr, cid, infohash)
    reached = 0
    tried = 0
    for ip, port in peers[:12]:
        tried += 1
        try:
            c = socket.create_connection((ip, port), timeout=3)
            c.close()
            reached += 1
        except Exception:
            pass
    print("%s  seeds=%d leechers=%d  peers recebidos=%d  conectaram por TCP=%d de %d"
          % (label, seeders, leechers, len(peers), reached, tried))


section("3. Referencia: torrent oficial do Ubuntu (sempre saudavel)")
if working is None:
    print("sem tracker UDP funcionando: nao da para perguntar pelos peers")
else:
    s, addr, cid, host = working
    try:
        name, ubuntu = ubuntu_reference()
        probe_peers("ubuntu    ", ubuntu)
        print("(%s)" % name)
    except Exception as e:
        print("nao deu para testar a referencia (%s)" % e)

section("4. Peers dos torrents que voce tentou abrir")
if not HASHES:
    print("(nenhum torrent tentado nos logs)")
elif working is None:
    print("sem tracker UDP funcionando: nao da para perguntar pelos peers")
else:
    s, addr, cid, host = working
    for infohash in HASHES[:4]:
        try:
            probe_peers(infohash[:10], infohash)
        except Exception as e:
            print("%s  FALHOU ao perguntar ao %s (%s)" % (infohash[:10], host, e))

section("5. IPv6")
try:
    c = socket.create_connection(("2606:4700:4700::1111", 443), timeout=4)
    c.close()
    print("ok     ha IPv6")
except Exception as e:
    print("sem IPv6 (%s) - normal no Docker; so importa se tudo acima falhou" % e)
