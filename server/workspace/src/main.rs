// Rust sample
use std::collections::HashMap;

#[derive(Debug)]
struct User {
    name: String,
    age: u32,
}

fn main() {
    let users = vec![
        User { name: "Ada".into(), age: 36 },
        User { name: "Kid".into(), age: 8 },
    ];

    let mut counts: HashMap<&str, usize> = HashMap::new();
    for user in &users {
        if user.age >= 18 {
            *counts.entry(user.name.as_str()).or_insert(0) += 1;
        }
    }

    println!("{:?}", counts);
}
