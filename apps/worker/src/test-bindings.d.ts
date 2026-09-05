interface CollectiveTestMigration {
  name: string;
  queries: string[];
}

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: CollectiveTestMigration[];
  }
}
