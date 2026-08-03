"use client";

// CTA "siga no Instagram" — banner compartilhado (home + tela de resultado).
// NUNCA renderizar em superfície de crise (clinical-safety: zero marketing em
// crise) — o gate é responsabilidade de quem monta a página.

const INSTAGRAM_URL = "https://www.instagram.com/cerebroamigooficial/";

// lucide-react removeu ícones de marca — glyph desenhado inline (mesmo traço do lucide).
function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

interface InstagramCtaProps {
  /** Sessão do teste quando existe (resultado); na home o clique gera um UUID efêmero. */
  sessionId?: string;
  scaleId?: string;
  className?: string;
}

export function InstagramCta({ sessionId, scaleId, className }: InstagramCtaProps) {
  const handleClick = () => {
    let sid = sessionId;
    if (!sid) {
      // Sem sessão (home): UUID efêmero só p/ contar o clique no funil — sem cookie,
      // sem persistência local, nada que identifique a pessoa (mesma postura anônima).
      try {
        sid = crypto.randomUUID();
      } catch {
        return;
      }
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "instagram_follow_click",
        sessionId: sid,
        ...(scaleId ? { scaleId } : {}),
      }),
    }).catch(() => {});
  };

  return (
    <a
      href={INSTAGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={`glass-noir flex min-h-[44px] items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:border-purple/40 ${className ?? ""}`}
    >
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-purple/25 bg-purple/10 text-purple-light"
        aria-hidden
      >
        <InstagramGlyph className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">
          Siga o Cérebro Amigo no Instagram
        </span>
        <span className="block text-xs text-muted-foreground">
          @cerebroamigooficial · conteúdo sobre saúde mental
        </span>
      </span>
      <span className="shrink-0 text-sm text-purple-light" aria-hidden>
        →
      </span>
    </a>
  );
}
