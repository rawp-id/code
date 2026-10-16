"""Sample Python file."""

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b


def main():
    print(list(fib(10)))


if __name__ == "__main__":
    main()
