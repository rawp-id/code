/* C sample */
#include <stdio.h>

typedef struct {
    const char *name;
    int age;
} User;

int main(void) {
    User users[] = {{"Ada", 36}, {"Kid", 8}};
    for (size_t i = 0; i < sizeof(users) / sizeof(users[0]); i++) {
        if (users[i].age >= 18) {
            printf("%s\n", users[i].name);
        }
    }
    return 0;
}
