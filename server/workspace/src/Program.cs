// C# sample
using System;
using System.Linq;

record User(string Name, int Age);

class Program
{
    static void Main()
    {
        var users = new[] { new User("Ada", 36), new User("Kid", 8) };
        var adults = users.Where(u => u.Age >= 18).Select(u => u.Name);
        Console.WriteLine(string.Join(", ", adults));
    }
}
