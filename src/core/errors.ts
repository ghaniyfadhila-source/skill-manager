/**
 * Galat domain dengan kode stabil. Server memetakan `code` ke status HTTP
 * (lihat src/server/app.ts); `core` tidak pernah tahu tentang HTTP.
 */
export interface SkillManagerErrorInit {
  code: string;
  message: string;
  details?: unknown;
}

export class SkillManagerError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor({ code, message, details }: SkillManagerErrorInit) {
    super(message);
    this.name = "SkillManagerError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
