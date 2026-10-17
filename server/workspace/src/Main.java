// Java sample
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    record User(String name, int age) {}

    public static void main(String[] args) {
        List<User> users = List.of(new User("Ada", 36), new User("Kid", 8));
        List<String> adults = users.stream()
            .filter(user -> user.age() >= 18)
            .map(User::name)
            .collect(Collectors.toList());
        System.out.println(adults);
    }
}
