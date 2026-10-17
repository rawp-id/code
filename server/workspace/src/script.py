"""Python sample."""
from dataclasses import dataclass


@dataclass
class User:
    name: str
    age: int


def adults(users: list[User]) -> list[str]:
    return [u.name for u in users if u.age >= 18]


if __name__ == "__main__":
    print(adults([User("Ada", 36), User("Kid", 8)]))
