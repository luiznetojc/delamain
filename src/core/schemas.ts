import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessLockfile, HarnessManifest, ValidationIssue } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = path.resolve(__dirname, "../..");

export type SchemaName =
  | "harness-manifest"
  | "harness-lock"
  | "workflow"
  | "handoff"
  | "telemetry-event";

interface JsonSchemaNode {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
}

const schemaCache = new Map<SchemaName, JsonSchemaNode>();

export function loadJsonSchema(name: SchemaName): JsonSchemaNode {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const schemaPath = path.join(HARNESS_ROOT, "schemas", `${name}.schema.json`);
  const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as JsonSchemaNode;
  schemaCache.set(name, parsed);
  return parsed;
}

export function validateAgainstSchema(
  name: SchemaName,
  data: unknown
): ValidationIssue[] {
  const rootSchema = loadJsonSchema(name);
  const issues: ValidationIssue[] = [];
  validateNode(rootSchema, rootSchema, data, "$", issues);
  return issues;
}

function resolveRef(root: JsonSchemaNode, ref: string): JsonSchemaNode {
  if (!ref.startsWith("#/$defs/")) {
    throw new Error(`Unsupported $ref in schema: ${ref}`);
  }
  const defKey = ref.slice("#/$defs/".length);
  const resolved = root.$defs?.[defKey];
  if (!resolved) {
    throw new Error(`Unresolved $ref definition: ${ref}`);
  }
  return resolved;
}

function validateNode(
  root: JsonSchemaNode,
  schema: JsonSchemaNode,
  value: unknown,
  currentPath: string,
  issues: ValidationIssue[]
): void {
  const effectiveSchema = schema.$ref ? resolveRef(root, schema.$ref) : schema;

  if (effectiveSchema.const !== undefined && value !== effectiveSchema.const) {
    issues.push({
      code: "SCHEMA_CONST_MISMATCH",
      severity: "error",
      path: currentPath,
      message: `Expected constant value ${JSON.stringify(effectiveSchema.const)}, got ${JSON.stringify(value)}`
    });
    return;
  }

  if (effectiveSchema.enum && !effectiveSchema.enum.includes(value)) {
    issues.push({
      code: "SCHEMA_ENUM_MISMATCH",
      severity: "error",
      path: currentPath,
      message: `Value ${JSON.stringify(value)} is not one of allowed values: ${effectiveSchema.enum.join(", ")}`
    });
    return;
  }

  if (effectiveSchema.type !== undefined) {
    const allowedTypes = Array.isArray(effectiveSchema.type)
      ? effectiveSchema.type
      : [effectiveSchema.type];
    const actualType = getJsonType(value);
    const matches = allowedTypes.some((t) =>
      t === "number" ? actualType === "number" || actualType === "integer" : t === actualType
    );
    if (!matches) {
      issues.push({
        code: "SCHEMA_TYPE_MISMATCH",
        severity: "error",
        path: currentPath,
        message: `Expected type ${allowedTypes.join("|")}, got ${actualType}`
      });
      return;
    }
  }

  if (typeof value === "string") {
    if (effectiveSchema.minLength !== undefined && value.length < effectiveSchema.minLength) {
      issues.push({
        code: "SCHEMA_MIN_LENGTH",
        severity: "error",
        path: currentPath,
        message: `String length ${value.length} is less than minimum ${effectiveSchema.minLength}`
      });
    }
    if (effectiveSchema.pattern !== undefined) {
      const regex = new RegExp(effectiveSchema.pattern);
      if (!regex.test(value)) {
        issues.push({
          code: "SCHEMA_PATTERN_MISMATCH",
          severity: "error",
          path: currentPath,
          message: `Value '${value}' does not match required pattern ${effectiveSchema.pattern}`
        });
      }
    }
  }

  if (typeof value === "number") {
    if (effectiveSchema.minimum !== undefined && value < effectiveSchema.minimum) {
      issues.push({
        code: "SCHEMA_MINIMUM",
        severity: "error",
        path: currentPath,
        message: `Value ${value} is less than minimum ${effectiveSchema.minimum}`
      });
    }
    if (effectiveSchema.maximum !== undefined && value > effectiveSchema.maximum) {
      issues.push({
        code: "SCHEMA_MAXIMUM",
        severity: "error",
        path: currentPath,
        message: `Value ${value} exceeds maximum ${effectiveSchema.maximum}`
      });
    }
  }

  if (Array.isArray(value)) {
    if (effectiveSchema.minItems !== undefined && value.length < effectiveSchema.minItems) {
      issues.push({
        code: "SCHEMA_MIN_ITEMS",
        severity: "error",
        path: currentPath,
        message: `Array has ${value.length} items, minimum required is ${effectiveSchema.minItems}`
      });
    }
    if (effectiveSchema.items) {
      value.forEach((item, idx) => {
        validateNode(root, effectiveSchema.items!, item, `${currentPath}[${idx}]`, issues);
      });
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (effectiveSchema.required) {
      for (const reqKey of effectiveSchema.required) {
        if (!(reqKey in obj) || obj[reqKey] === undefined) {
          issues.push({
            code: "SCHEMA_REQUIRED_PROPERTY",
            severity: "error",
            path: `${currentPath}.${reqKey}`,
            message: `Missing required property '${reqKey}'`
          });
        }
      }
    }

    const props = effectiveSchema.properties ?? {};
    for (const [key, propVal] of Object.entries(obj)) {
      if (propVal === undefined) continue;
      if (key in props) {
        validateNode(root, props[key]!, propVal, `${currentPath}.${key}`, issues);
      } else if (effectiveSchema.additionalProperties === false) {
        issues.push({
          code: "SCHEMA_ADDITIONAL_PROPERTY",
          severity: "error",
          path: `${currentPath}.${key}`,
          message: `Unexpected property '${key}' is not allowed by schema`
        });
      } else if (
        typeof effectiveSchema.additionalProperties === "object" &&
        effectiveSchema.additionalProperties !== null
      ) {
        validateNode(
          root,
          effectiveSchema.additionalProperties,
          propVal,
          `${currentPath}.${key}`,
          issues
        );
      }
    }
  }
}

function getJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

export function validateManifestSchema(manifest: unknown): {
  valid: boolean;
  issues: ValidationIssue[];
  manifest?: HarnessManifest;
} {
  const issues = validateAgainstSchema("harness-manifest", manifest);
  return {
    valid: issues.length === 0,
    issues,
    manifest: issues.length === 0 ? (manifest as HarnessManifest) : undefined
  };
}

export function validateLockfileSchema(lockfile: unknown): {
  valid: boolean;
  issues: ValidationIssue[];
  lockfile?: HarnessLockfile;
} {
  const issues = validateAgainstSchema("harness-lock", lockfile);
  return {
    valid: issues.length === 0,
    issues,
    lockfile: issues.length === 0 ? (lockfile as HarnessLockfile) : undefined
  };
}
