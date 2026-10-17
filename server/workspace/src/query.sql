-- SQL sample
SELECT u.id, u.name, COUNT(o.id) AS orders
FROM users AS u
LEFT JOIN orders AS o ON o.user_id = u.id
WHERE u.active = TRUE
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 0
ORDER BY orders DESC
LIMIT 10;
