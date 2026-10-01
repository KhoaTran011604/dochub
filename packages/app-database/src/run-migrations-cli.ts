import { runMigrations } from "./run-migrations.ts";

try {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Applied ${applied.length} migration(s):`);
    for (const name of applied) console.log(`  - ${name}`);
  }
} catch (error) {
  // Chỉ in message: lỗi kết nối của pg có thể kèm connection string.
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
