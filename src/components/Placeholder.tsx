// A labelled placeholder. Deliberately says WHICH region rendered it and WHICH work
// item fills it in: the point of R3-386 is to prove the binding resolves and the
// right half renders in the right slot, and a blank panel cannot show either.
export default function Placeholder({
  region,
  title,
  detail,
  item,
}: {
  region: string | null;
  title: string;
  detail: string;
  item: string;
}) {
  return (
    <section className="ph" aria-labelledby="ph-title">
      <header className="ph-hd">
        <h1 className="ph-title" id="ph-title">
          {title}
        </h1>
        <code className="ph-region">{region ?? 'standalone'}</code>
      </header>
      <p className="ph-detail">{detail}</p>
      <p className="ph-item">
        Not built yet — <code>{item}</code>
      </p>
    </section>
  );
}
