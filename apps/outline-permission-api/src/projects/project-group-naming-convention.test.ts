import { describe, expect, it } from "vitest";
import {
  PROJECT_KEY_PATTERN,
  projectGroupExternalId,
  projectGroupName,
  ROLE_TO_COLLECTION_PERMISSION,
} from "./project-group-naming-convention.ts";

describe("project-group-naming-convention", () => {
  it("builds group name as <projectKey>-<role>", () => {
    expect(projectGroupName("acme-portal", "viewer")).toBe("acme-portal-viewer");
    expect(projectGroupName("acme-portal", "editor")).toBe("acme-portal-editor");
    expect(projectGroupName("acme-portal", "manager")).toBe("acme-portal-manager");
  });

  it("builds externalId as <projectKey>:<role> for reverse lookup", () => {
    expect(projectGroupExternalId("acme-portal", "manager")).toBe("acme-portal:manager");
  });

  it("maps project role to the matching Outline collection permission", () => {
    expect(ROLE_TO_COLLECTION_PERMISSION).toEqual({
      viewer: "read",
      editor: "read_write",
      manager: "admin",
    });
  });

  describe("PROJECT_KEY_PATTERN", () => {
    // Pattern đòi hỏi ít nhất 2 ký tự (1 ký tự đầu + {1,40} ký tự sau).
    it.each(["ab", "acme", "acme-portal", "a1-2b"])("accepts %s", (key) => {
      expect(PROJECT_KEY_PATTERN.test(key)).toBe(true);
    });

    it.each(["", "a", "-acme", "Acme", "acme_portal", "a".repeat(42)])("rejects %s", (key) => {
      expect(PROJECT_KEY_PATTERN.test(key)).toBe(false);
    });
  });
});
