package worker

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Numa maquina so, quem assiste pode estar em outro computador da rede. O
// endereco que o navegador recebe nao pode ser o do worker, que so existe
// dentro do compose, nem um endereco fixo, que muda de IP; tem de ser o mesmo
// de onde a pagina veio.
func TestEffectiveBaseAtTheSameOriginAsThePage(t *testing.T) {
	w := &Worker{ID: "w1", PublicBase: "http://worker:8081"}
	w.Heartbeat.Relayed = true

	require.Equal(t, "/relay/w1", w.EffectiveBase(SameOrigin))
	require.Equal(t, "https://ss.example/relay/w1", w.EffectiveBase("https://ss.example"))
}

func TestEffectiveBaseFallsBackToTheWorkersOwnAddress(t *testing.T) {
	w := &Worker{ID: "w1", PublicBase: "https://w1.example"}

	// Sem a marca de relay, nem o servidor pode falar pelo worker.
	require.Equal(t, "https://w1.example", w.EffectiveBase(SameOrigin))

	w.Heartbeat.Relayed = true
	// Marcado, mas sem base configurada: nada para onde apontar.
	require.Equal(t, "https://w1.example", w.EffectiveBase(""))
}
