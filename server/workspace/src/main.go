// Go sample
package main

import "fmt"

type User struct {
	Name string
	Age  int
}

func adults(users []User) []string {
	var names []string
	for _, user := range users {
		if user.Age >= 18 {
			names = append(names, user.Name)
		}
	}
	return names
}

func main() {
	fmt.Println(adults([]User{{"Ada", 36}, {"Kid", 8}}))
}
