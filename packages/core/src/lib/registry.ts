/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Typed dependency injection registry. Ported from the Modulus project
 * (https://github.com/infonomic/modulus) with permission.
 *
 * Provides compile-time validation of dependency graphs via TypeScript
 * conditional types. Services declare their dependencies via constructor
 * or factory signatures; the registry validates that all requirements
 * are satisfied before composition.
 */

type Token = string | symbol

type Normalize<T> = T extends object ? { [P in keyof T]: T[P] } : never

type Extend<TSource extends object, TName extends Token, TValue> = Normalize<
  Omit<TSource, TName> & {
    [K in TName]: TValue
  }
>

type Provider = {
  type: 'class' | 'async-class' | 'factory' | 'value' | 'nested'
  name: Token
  value: any
}

type IsNever<T> = [T] extends [never] ? true : false

// Helper type to check if an intersection results in never for any property
type IsMergeable<T1, T2> =
  {
    [K in keyof T1 & keyof T2]: IsNever<T1[K] & T2[K]> extends true ? false : true
  } extends Record<keyof T1 & keyof T2, true>
    ? true
    : false

type ValidateDeps<TRequires, TProvides, TName, TDeps> =
  // Is TName among the previously required names?
  TName extends keyof TRequires
    ? // Yes -- error
      {
        error: 'Name conflict with prior requirement'
        name: TName
        requirements: TRequires
      }
    : // No -- continue
      // Is TName among the previously provided names?
      TName extends keyof TProvides
      ? // Yes -- error
        { error: 'Duplicate provider name'; name: TName }
      : // No -- continue
        // Are all provided values compatible with the requested dependencies?
        Pick<TProvides, keyof TProvides & keyof TDeps> extends Pick<
            TDeps,
            keyof TProvides & keyof TDeps
          >
        ? // Yes -- continue
          // Are requested dependencies that aren't being provided mergeable
          // with previously required dependencies?
          IsMergeable<
            Pick<
              Omit<TDeps, keyof TProvides>,
              Extract<keyof TRequires, keyof Omit<TDeps, keyof TProvides>>
            >,
            Pick<TRequires, Extract<keyof TRequires, keyof Omit<TDeps, keyof TProvides>>>
          > extends true
          ? // Yes -- success!
            true
          : // No -- error
            {
              error: 'Dependency type conflicts with required type'
              deps: TDeps
              requirements: TRequires
            }
        : // No -- error
          {
            error: 'Dependency type conflicts with provided type'
            deps: TDeps
            provides: TProvides
          }

export class Registry<
  TRequires extends Record<Token, unknown> = {},
  TProvides extends Record<Token, unknown> = {},
> {
  private readonly providers: Provider[] = []

  addClass<
    Name extends Token,
    TClass extends new (
      deps: any
    ) => any,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      ConstructorParameters<TClass>[0]
    > = ValidateDeps<TRequires, TProvides, Name, ConstructorParameters<TClass>[0]>,
  >(
    name: Name,
    value: TValidation extends true ? TClass : TValidation
  ): Registry<
    Normalize<TRequires & Omit<ConstructorParameters<TClass>[0], keyof TProvides>>,
    Extend<TProvides, Name, InstanceType<TClass>>
  > {
    this.providers.push({
      type: 'class',
      name,
      value,
    })
    return this as any
  }

  addFactory<
    Name extends Token,
    TFactory extends (deps: any) => any,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      Parameters<TFactory>[0]
    > = ValidateDeps<TRequires, TProvides, Name, Parameters<TFactory>[0]>,
  >(
    name: Name,
    value: TValidation extends true ? TFactory : TValidation
  ): Registry<
    Normalize<TRequires & Omit<Parameters<TFactory>[0], keyof TProvides>>,
    Extend<TProvides, Name, ReturnType<TFactory>>
  > {
    this.providers.push({
      type: 'factory',
      name,
      value,
    })
    return this as any
  }

  addValue<
    Name extends Token,
    TValue,
    TValidation extends ValidateDeps<TRequires, TProvides, Name, {}> = ValidateDeps<
      TRequires,
      TProvides,
      Name,
      {}
    >,
  >(
    name: Name,
    value: TValidation extends true ? TValue : TValidation
  ): Registry<TRequires, Extend<TProvides, Name, TValue>> {
    this.providers.push({
      type: 'value',
      name,
      value,
    })
    return this as any
  }

  addNested<
    Name extends Token,
    TNested extends Registry<any, any>,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends Registry<infer TNestedRequired, any> ? TNestedRequired : never
    > = ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends Registry<infer TNestedRequired, any> ? TNestedRequired : never
    >,
  >(
    name: Name,
    nested: TValidation extends true ? TNested : TValidation
  ): TNested extends Registry<infer TNestedRequires, infer TNestedProvides>
    ? Registry<
        Normalize<TRequires & Omit<TNestedRequires, keyof TProvides>>,
        Extend<TProvides, Name, TNestedProvides>
      >
    : never {
    this.providers.push({ type: 'nested', name, value: nested })
    return this as any
  }

  compose(requirements: TRequires): Normalize<TProvides> {
    const result = {} as any
    const context = { ...requirements } as any

    for (const { type, name, value } of this.providers) {
      if (type === 'value') {
        context[name] = result[name] = value
      } else if (type === 'class') {
        context[name] = result[name] = new value(context)
      } else if (type === 'factory') {
        context[name] = result[name] = value(context)
      } else if (type === 'nested') {
        const nestedResult = value.compose(context)
        context[name] = result[name] = nestedResult
      }
    }

    return result
  }
}

export class AsyncRegistry<
  TRequires extends Record<Token, unknown> = {},
  TProvides extends Record<Token, unknown> = {},
> {
  private readonly providers: Provider[] = []

  addClass<
    Name extends Token,
    TClass extends new (
      deps: any
    ) => any,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      ConstructorParameters<TClass>[0]
    > = ValidateDeps<TRequires, TProvides, Name, ConstructorParameters<TClass>[0]>,
  >(
    name: Name,
    value: TValidation extends true ? TClass : TValidation
  ): AsyncRegistry<
    Normalize<TRequires & Omit<ConstructorParameters<TClass>[0], keyof TProvides>>,
    Extend<TProvides, Name, InstanceType<TClass>>
  > {
    this.providers.push({
      type: 'class',
      name,
      value,
    })
    return this as any
  }

  addAsyncClass<
    Name extends Token,
    TClass extends { create(deps: any): Promise<any> },
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      Parameters<TClass['create']>[0]
    > = ValidateDeps<TRequires, TProvides, Name, Parameters<TClass['create']>[0]>,
  >(
    name: Name,
    value: TValidation extends true ? TClass : TValidation
  ): AsyncRegistry<
    Normalize<TRequires & Omit<Parameters<TClass['create']>[0], keyof TProvides>>,
    Extend<TProvides, Name, Awaited<ReturnType<TClass['create']>>>
  > {
    this.providers.push({
      type: 'async-class',
      name,
      value,
    })
    return this as any
  }

  addFactory<
    Name extends Token,
    TFactory extends (deps: any) => any,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      Parameters<TFactory>[0]
    > = ValidateDeps<TRequires, TProvides, Name, Parameters<TFactory>[0]>,
  >(
    name: Name,
    value: TValidation extends true ? TFactory : TValidation
  ): AsyncRegistry<
    Normalize<TRequires & Omit<Parameters<TFactory>[0], keyof TProvides>>,
    Extend<TProvides, Name, Awaited<ReturnType<TFactory>>>
  > {
    this.providers.push({
      type: 'factory',
      name,
      value,
    })
    return this as any
  }

  addValue<
    Name extends Token,
    TValue,
    TValidation extends ValidateDeps<TRequires, TProvides, Name, {}> = ValidateDeps<
      TRequires,
      TProvides,
      Name,
      {}
    >,
  >(
    name: Name,
    value: TValidation extends true ? TValue : TValidation
  ): AsyncRegistry<TRequires, Extend<TProvides, Name, Awaited<TValue>>> {
    this.providers.push({
      type: 'value',
      name,
      value,
    })
    return this as any
  }

  addNested<
    Name extends Token,
    TNested extends Registry<any, any>,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends Registry<infer TNestedRequired, any> ? TNestedRequired : never
    > = ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends Registry<infer TNestedRequired, any> ? TNestedRequired : never
    >,
  >(
    name: Name,
    nested: TValidation extends true ? TNested : TValidation
  ): TNested extends Registry<infer TNestedRequires, infer TNestedProvides>
    ? AsyncRegistry<
        Normalize<TRequires & Omit<TNestedRequires, keyof TProvides>>,
        Extend<TProvides, Name, TNestedProvides>
      >
    : never {
    this.providers.push({ type: 'nested', name, value: nested })
    return this as any
  }

  addNestedAsync<
    Name extends Token,
    TNested extends AsyncRegistry<any, any>,
    TValidation extends ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends AsyncRegistry<infer TNestedRequired, any> ? TNestedRequired : never
    > = ValidateDeps<
      TRequires,
      TProvides,
      Name,
      TNested extends AsyncRegistry<infer TNestedRequired, any> ? TNestedRequired : never
    >,
  >(
    name: Name,
    nested: TValidation extends true ? TNested : TValidation
  ): TNested extends AsyncRegistry<infer TNestedRequires, infer TNestedProvides>
    ? AsyncRegistry<
        Normalize<TRequires & Omit<TNestedRequires, keyof TProvides>>,
        Extend<TProvides, Name, TNestedProvides>
      >
    : never {
    this.providers.push({ type: 'nested', name, value: nested })
    return this as any
  }

  async compose(requirements: TRequires): Promise<Normalize<TProvides>> {
    const result = {} as any
    const context = { ...requirements } as any

    for (const { type, name, value } of this.providers) {
      if (type === 'value') {
        context[name] = result[name] = await value
      } else if (type === 'class') {
        context[name] = result[name] = new value(context)
      } else if (type === 'async-class') {
        context[name] = result[name] = await value.create(context)
      } else if (type === 'factory') {
        context[name] = result[name] = await value(context)
      } else if (type === 'nested') {
        const nestedResult = await value.compose(context)
        context[name] = result[name] = nestedResult
      }
    }

    return result
  }
}

export type RegisteredServices<TRegistry extends Registry<any, any> | AsyncRegistry<any, any>> =
  TRegistry extends Registry<any, infer TProvided>
    ? TProvided
    : TRegistry extends AsyncRegistry<any, infer TProvided>
      ? Normalize<TProvided>
      : never
