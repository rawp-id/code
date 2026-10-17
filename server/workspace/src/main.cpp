// C++ sample
#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

struct User {
    std::string name;
    int age;
};

int main() {
    std::vector<User> users{{"Ada", 36}, {"Kid", 8}};
    std::for_each(users.begin(), users.end(), [](const User &user) {
        if (user.age >= 18) std::cout << user.name << "\n";
    });
    return 0;
}
