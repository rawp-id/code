<?php
// PHP sample
declare(strict_types=1);

final class User
{
    public function __construct(
        public readonly string $name,
        public readonly int $age,
    ) {}
}

function adults(array $users): array
{
    return array_values(array_filter(
        $users,
        static fn (User $user): bool => $user->age >= 18,
    ));
}

$users = [new User('Ada', 36), new User('Kid', 8)];
echo implode(', ', array_map(static fn (User $u): string => $u->name, adults($users)));
