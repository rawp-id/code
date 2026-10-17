// Kotlin sample
data class User(val name: String, val age: Int)

fun main() {
    val users = listOf(User("Ada", 36), User("Kid", 8))
    val adults = users.filter { it.age >= 18 }.map { it.name }
    println(adults.joinToString(", "))
}
