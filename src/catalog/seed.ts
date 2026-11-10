/**
 * Allowlist katalog: daftar skill GitHub yang DIPERCAYA (dikurasi manusia).
 * Setiap entri menunjuk satu skill di dalam sebuah repositori via `subdir`,
 * sehingga monorepo seperti anthropics/skills tetap bisa dipasangi per skill.
 *
 * `name` wajib sama dengan field `name` di frontmatter SKILL.md (sudah
 * diverifikasi saat kurasi) supaya lookup "sudah di Library?" cocok.
 * Deskripsi di sini adalah ringkasan kurasi, bukan salinan deskripsi skill.
 */
export interface CatalogSeed {
  readonly owner: string;
  readonly repo: string;
  readonly subdir: string;
  readonly name: string;
  readonly description: string;
}

export const CATALOG_SEED: readonly CatalogSeed[] = [
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/docx",
    name: "docx",
    description: "Buat, baca, dan edit dokumen Word (.docx) dengan rapi.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/pdf",
    name: "pdf",
    description: "Baca, gabung, pisah, dan buat berkas PDF.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/pptx",
    name: "pptx",
    description: "Buat dan edit presentasi PowerPoint (.pptx).",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/xlsx",
    name: "xlsx",
    description: "Kelola spreadsheet Excel/CSV: baca, edit, bersihkan data.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/frontend-design",
    name: "frontend-design",
    description: "Arah desain visual yang khas untuk UI baru.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/mcp-builder",
    name: "mcp-builder",
    description: "Bangun MCP server Python/Node untuk integrasi eksternal.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/webapp-testing",
    name: "webapp-testing",
    description: "Uji aplikasi web lokal dengan Playwright.",
  },
  {
    owner: "anthropics",
    repo: "skills",
    subdir: "skills/skill-creator",
    name: "skill-creator",
    description: "Buat, edit, dan evaluasi skill baru.",
  },
  {
    owner: "obra",
    repo: "superpowers",
    subdir: "skills/test-driven-development",
    name: "test-driven-development",
    description: "Tulis test dulu sebelum kode implementasi.",
  },
  {
    owner: "obra",
    repo: "superpowers",
    subdir: "skills/systematic-debugging",
    name: "systematic-debugging",
    description: "Loop diagnosis untuk bug dan regresi yang sulit.",
  },
  {
    owner: "obra",
    repo: "superpowers",
    subdir: "skills/writing-plans",
    name: "writing-plans",
    description: "Susun plan dari spec sebelum menulis kode.",
  },
  {
    owner: "wshobson",
    repo: "agents",
    subdir: "plugins/backend-development/skills/api-design-principles",
    name: "api-design-principles",
    description: "Prinsip desain API REST dan GraphQL.",
  },
  {
    owner: "wshobson",
    repo: "agents",
    subdir: "plugins/cicd-automation/skills/github-actions-templates",
    name: "github-actions-templates",
    description: "Workflow CI/CD GitHub Actions siap pakai.",
  },
];
