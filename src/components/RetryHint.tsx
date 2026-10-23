// Aviso de que el bloque se está recuperando solo. La cuenta atrás vive en una
// región aria-live="off" (cambia cada segundo y no debe anunciarse); el texto que
// sí importa —que hay un reintento en curso— se anuncia una sola vez.
// El número va en una caja de 2ch alineada a la derecha para que «9s» y «60s»
// ocupen lo mismo y la línea no baile al cambiar de dígito.
export function RetryHint({ retrying, retryIn }: { retrying: boolean; retryIn: number }) {
  return (
    <span className="text-[11px] text-base-content/70">
      {retrying ? (
        <span aria-live="polite">Reintentando ahora…</span>
      ) : (
        <>
          <span aria-live="polite">Reintento automático</span>
          <span aria-live="off" className="tabular-nums">
            {retryIn > 0
              ? <> en <span className="inline-block w-[2ch] text-right">{retryIn}</span>s</>
              : ' en curso'}
          </span>
        </>
      )}
    </span>
  );
}
