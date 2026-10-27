---
name: dotnet-backend
description: >-
  Best practices and validation procedures for C# and .NET backend services,
  including xUnit testing, nullable reference types, and deterministic builds.
---

# .NET Backend Skill

Use this skill when developing or validating C# / .NET projects.

## Procedure

1. **Compiler & Nullable Strictness**: Keep `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>` respected; resolve compiler warnings.
2. **Dependency Injection & Interfaces**: Register services with appropriate lifetimes (`Scoped`, `Singleton`, `Transient`) behind focused interfaces.
3. **xUnit Verification**: Write `[Fact]` and `[Theory]` tests in the corresponding `.Tests` project.
4. **Validation Commands**:
   - Build: `dotnet build --nologo`
   - Test: `dotnet test --no-build --nologo`
