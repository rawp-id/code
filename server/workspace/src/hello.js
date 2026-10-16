// Sample file. The demo language server flags the long line and the FIXME below.

const greeting = "hello";

function greet(name) {
  return `${greeting}, ${name}!`;
}

function main() {
  const names = ["Ada", "Linus", "Grace", "Margaret", "Barbara", "Radia", "Guido", "Anders"];
  for (const name of names) {
    console.log(greet(name)); // FIXME remove logging before shipping
  }
}

const veryLongLine = "This line is deliberately longer than one hundred characters so that the demo language server has something interesting to report to you.";

main();
