# Ruby sample
User = Struct.new(:name, :age)

users = [User.new("Ada", 36), User.new("Kid", 8)]
adults = users.select { |user| user.age >= 18 }.map(&:name)
puts adults.join(", ")
