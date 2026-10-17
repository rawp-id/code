// TypeScript sample
interface User {
  id: number;
  name: string;
  admin?: boolean;
}

export function findUser(users: User[], id: number): User | undefined {
  return users.find((user) => user.id === id);
}

const count: number = 3;
export default count;
