import { useEffect, useState } from 'react';
import { play } from '@/lib/sound';

interface Trend {
  title: string;
  traffic: string;
  snippet: string;
}

const SEARCH_ENGINES = [
  {
    key: 'google', name: 'Google', url: 'https://google.com/search?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>,
  },
  {
    key: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 23C5.925 23 1 18.074 1 12S5.926 1 12 1s11 4.925 11 11-4.925 11-11 11zm10.219-11c0 4.805-3.317 8.833-7.786 9.925-.27-.521-.53-1.017-.749-1.438.645.249 1.93.718 2.208.615.376-.144.282-3.149-.14-3.245-.338-.075-1.632.837-2.141 1.209l.034.156c.078.397.144.993.03 1.247-.001.004-.002.01-.004.013a.218.218 0 01-.068.088c-.284.188-1.081.284-1.503.188a.516.516 0 01-.064-.02c-.694.396-2.01 1.109-2.25.971-.329-.188-.377-2.676-.329-3.288.035-.46 1.653.286 2.442.679.174-.163.602-.272.98-.31-.57-1.389-.99-2.977-.733-4.105 0 .002.002.002.002.002.356.248 2.73 1.05 3.91 1.027 1.18-.024 3.114-.743 2.903-1.323-.212-.58-2.135.51-4.142.324-1.486-.138-1.748-.804-1.42-1.29.414-.611 1.168.116 2.411-.256 1.245-.371 2.987-1.035 3.632-1.397 1.494-.833-.625-1.177-1.125-.947-.474.22-2.123.637-2.889.82.428-1.516-.603-4.149-1.757-5.3-.376-.376-.951-.612-1.603-.736-.25-.344-.654-.671-1.225-.977a5.772 5.772 0 00-3.595-.584l-.024.004-.034.004.004.002c-.148.028-.237.08-.357.098.148.016.705.276 1.057.418-.174.068-.412.108-.596.184a.828.828 0 00-.204.056c-.173.08-.303.375-.3.515.84-.086 2.082-.026 2.991.246-.644.09-1.235.258-1.661.482-.016.008-.03.018-.048.028-.054.02-.106.042-.152.066-1.367.72-1.971 2.405-1.611 4.424.323 1.824 1.665 8.088 2.29 11.064-3.973-1.4-6.822-5.186-6.822-9.639C1.781 6.356 6.356 1.781 12 1.781S22.219 6.356 22.219 12zM9.095 9.581a.758.758 0 100 1.516.758.758 0 000-1.516zm.338.702a.196.196 0 110-.392.196.196 0 010 .392zm4.724-1.043a.65.65 0 100 1.299.65.65 0 000-1.3zm.29.601a.168.168 0 110-.336.168.168 0 010 .336zM9.313 8.146s-.571-.26-1.125.09c-.554.348-.534.704-.534.704s-.294-.656.49-.978c.786-.32 1.17.184 1.17.184zm5.236-.052s-.41-.234-.73-.23c-.654.008-.831.296-.831.296s.11-.688.945-.55a.84.84 0 01.616.484z"/></svg>,
  },
  {
    key: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z"/></svg>,
  },
  {
    key: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.313 5.163c4.289 0 7.766 2.589 7.766 7.616 0 4.759-3.072 7.301-7.003 7.59 1.87 1.142 4.693 1.143 6.45-.348l.547.297-.615 3.074-.226.285c-3.118.918-5.947-.099-7.921-3.329-3.816-.37-6.765-2.9-6.765-7.568 0-5.03 3.477-7.617 7.766-7.617zm0 13.88c2.756 0 4.08-2.804 4.08-6.264 0-3.46-1.148-6.264-4.08-6.264-2.85 0-4.08 2.805-4.08 6.264 0 3.46 1.182 6.264 4.08 6.264zm8.719-16.319L18.734 0h.263l.703 2.725 2.754.71v.248l-2.754.71-.703 2.725h-.263l-.702-2.725-2.696-.695V3.42z"/></svg>,
  },
  {
    key: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search/new?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"/></svg>,
  },
  {
    key: 'twitter', name: 'X / Twitter', url: 'https://www.twitter.com/search?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>,
  },
  {
    key: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/search?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>,
  },
  {
    key: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/search?q=',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg>,
  },
];

export function GoogleTrendsWidget() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/trends')
      .then((r) => r.json())
      .then((data) => {
        setTrends(data.trends || []);
        if (data.error) setError(data.error);
      })
      .catch(() => setError('Error de conexión al servidor'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl animate-pulse">
            <span className="text-xs font-mono text-base-content/70 w-5 text-right shrink-0">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="h-3 bg-base-300 rounded w-full" />
              <div className="h-2.5 bg-base-300 rounded w-2/3" />
            </div>
            <div className="h-5 w-12 bg-base-300 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (trends.length === 0) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center">
        <p className="text-sm text-base-content/70">Tendencias de Google no disponibles</p>
        {error && (
          <p className="text-[10px] text-base-content/40 mt-1.5">{error}</p>
        )}
        <div className="mt-2">
          <a href="https://trends.google.com/trending?geo=CL" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')}            className="text-[10px] text-base-content/70 underline underline-offset-2 hover:text-base-content transition-colors">
            Ver en Google Trends →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-1">
      {trends.map((trend, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05] transition-colors"
        >
          <span className="text-xs font-mono text-base-content/70 w-5 text-right shrink-0 mt-0.5">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(trend.title)}&date=now%201-d&geo=CL&hl=es`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.tap')}
              className="text-base text-base-content truncate block no-underline hover:underline active:scale-[0.96] transition-all"
            >
              {trend.title}
            </a>
            {trend.snippet && (
              <p className="text-[11px] text-base-content/70 line-clamp-1 mt-0.5">{trend.snippet}</p>
            )}
            <div className="flex items-center gap-1 mt-1.5">
              {SEARCH_ENGINES.map((se) => (
                <a
                  key={se.key}
                  href={se.url + encodeURIComponent(trend.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 rounded-full flex items-center justify-center text-base-content/50 hover:text-base-content bg-base-content/[0.03] hover:bg-base-300 border border-base-content/[0.06] hover:border-base-content/20 transition-colors"
                  title={`Buscar "${trend.title}" en ${se.name}`}
                  onClick={(e) => { play('interaction.tap'); e.stopPropagation(); }}
                >
                  <span className="w-3.5 h-3.5">{se.icon}</span>
                </a>
              ))}
            </div>
          </div>
          {trend.traffic && (
            <span className="text-[10px] text-primary-content font-medium shrink-0 bg-primary px-2 py-0.5 rounded-full mt-0.5">
              {trend.traffic}
            </span>
          )}
        </div>
      ))}
      </div>
      <div className="mt-3 text-right text-[10px] text-base-content/70">
        Fuente:{' '}
        <a href="https://trends.google.com/trending?geo=CL" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">
          Google Trends
        </a>
      </div>
    </div>
  );
}
