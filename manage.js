import db from "./db.js";
import bcrypt from "bcrypt";

/**
 * SASTOCK Management Tool (CLI)
 * Run this on your VPS to manage users and settings without the web UI.
 */

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "list-users":
      try {
        const users = db.prepare("SELECT id, username, role, created_at FROM users").all();
        console.log("\n--- USER LIST ---");
        console.table(users);
      } catch (err) {
        console.error("Error listing users:", err.message);
      }
      break;

    case "reset-password":
      const [userToReset, newPass] = args.slice(1);
      if (!userToReset || !newPass) {
        console.log("Usage: node manage.js reset-password <username> <new_password>");
        return;
      }
      try {
        const hashedPassword = await bcrypt.hash(newPass, 10);
        const result = db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hashedPassword, userToReset);
        if (result.changes > 0) {
          console.log(`Successfully updated password for ${userToReset}.`);
        } else {
          console.log(`User '${userToReset}' not found.`);
        }
      } catch (err) {
        console.error("Error resetting password:", err.message);
      }
      break;

    case "add-key":
      const [username, keyLabel, keyValue] = args.slice(1);
      if (!username || !keyLabel || !keyValue) {
        console.log("Usage: node manage.js add-key <username> <label> <api_key>");
        return;
      }
      try {
        const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (!user) {
          console.log(`User '${username}' not found.`);
          return;
        }
        db.prepare("INSERT INTO api_keys (user_id, label, key_value) VALUES (?, ?, ?)")
          .run(user.id, keyLabel, keyValue);
        console.log(`Successfully added key '${keyLabel}' for user ${username}.`);
      } catch (err) {
        console.error("Error adding key:", err.message);
      }
      break;

    case "list-keys":
      try {
        const keys = db.prepare(`
          SELECT k.id, u.username, k.label, k.key_value, k.created_at 
          FROM api_keys k 
          JOIN users u ON k.user_id = u.id
        `).all();
        console.log("\n--- API KEYS LIST ---");
        // Mask keys for safety in display
        const displayKeys = keys.map(k => ({
          ...k,
          key_value: k.key_value.substring(0, 6) + "..." + k.key_value.substring(k.key_value.length - 4)
        }));
        console.table(displayKeys);
      } catch (err) {
        console.error("Error listing keys:", err.message);
      }
      break;

    default:
      console.log("\n--- SASTOCK CLI HELP ---");
      console.log("Commands:");
      console.log("  list-users");
      console.log("  reset-password <username> <new_password>");
      console.log("  add-key <username> <label> <api_key>");
      console.log("  list-keys");
      break;
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
