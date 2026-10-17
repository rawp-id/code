// JavaScript sample
const users = [
  { name: "Ada", age: 36 },
  { name: "Linus", age: 54 },
];

function adults(list) {
  return list.filter((user) => user.age >= 18);
}

console.log(adults(users).map((u) => u.name).join(", "));
