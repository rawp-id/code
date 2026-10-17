// TSX sample
type Props = { title: string; items: string[] };

export function List({ title, items }: Props) {
  return (
    <section>
      <h2>{title}</h2>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}
