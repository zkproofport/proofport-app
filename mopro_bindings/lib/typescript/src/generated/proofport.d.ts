import { type UniffiByteArray, RustBuffer, uniffiTypeNameSymbol } from "uniffi-bindgen-react-native";
/**
 * Combine proof and public inputs back into a single proof
 * Used when you need to reconstruct the combined format
 */
export declare function combineProofAndPublicInputs(proof: ArrayBuffer, publicInputs: Array<ArrayBuffer>): ArrayBuffer;
export declare function generateCircomProof(zkeyPath: string, circuitInputs: string, proofLib: ProofLib): CircomProofResult;
export declare function generateHalo2Proof(srsPath: string, pkPath: string, circuitInputs: Map<string, Array<string>>): Halo2ProofResult;
/**
 * Generates a Noir proof with automatic hash function selection
 *
 * This is the main proof generation function that automatically chooses
 * the appropriate hash function based on the intended use case:
 *
 * - `on_chain = true`: Uses Keccak hash for Solidity verifier compatibility
 * - `on_chain = false`: Uses Poseidon hash for better performance
 */
export declare function generateNoirProof(circuitPath: string, srsPath: string | undefined, inputs: Array<string>, onChain: boolean, vk: ArrayBuffer, lowMemoryMode: boolean): ArrayBuffer;
/**
 * Generates a verification key with automatic hash function selection
 *
 * This function automatically chooses the appropriate hash function based
 * on the intended use case:
 *
 * - `on_chain = true`: Uses Keccak hash for Solidity verifier compatibility
 * - `on_chain = false`: Uses Poseidon hash fotr better performance
 */
export declare function getNoirVerificationKey(circuitPath: string, srsPath: string | undefined, onChain: boolean, lowMemoryMode: boolean): ArrayBuffer;
/**
 * Get the number of public inputs from a circuit's JSON manifest
 * This reads the circuit bytecode and extracts the public parameter count
 */
export declare function getNumPublicInputsFromCircuit(circuitPath: string): number;
/**
 * You can also customize the bindings by #[uniffi::export]
 * Reference: https://mozilla.github.io/uniffi-rs/latest/proc_macro/index.html
 */
export declare function moproHelloWorld(): string;
/**
 * Parse a combined proof (proof + public inputs) into separated components
 * The mopro proof format has public inputs prepended to the proof bytes
 * This function separates them for on-chain verification
 */
export declare function parseProofWithPublicInputs(proof: ArrayBuffer, numPublicInputs: number): ProofWithPublicInputs;
export declare function verifyCircomProof(zkeyPath: string, proofResult: CircomProofResult, proofLib: ProofLib): boolean;
export declare function verifyHalo2Proof(srsPath: string, vkPath: string, proof: ArrayBuffer, publicInput: ArrayBuffer): boolean;
/**
 * Verifies a Noir proof with automatic hash function selection
 *
 * This function automatically uses the correct verification method based
 * on how the proof was generated:
 *
 * - `on_chain = true`: Verifies Keccak-based proof (Solidity compatible)
 * - `on_chain = false`: Verifies Poseidon-based proof (performance optimized)
 */
export declare function verifyNoirProof(circuitPath: string, proof: ArrayBuffer, onChain: boolean, vk: ArrayBuffer, lowMemoryMode: boolean): boolean;
export type CircomProof = {
    a: G1;
    b: G2;
    c: G1;
    protocol: string;
    curve: string;
};
/**
 * Generated factory for {@link CircomProof} record objects.
 */
export declare const CircomProof: Readonly<{
    /**
     * Create a frozen instance of {@link CircomProof}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<CircomProof> & Required<Omit<CircomProof, never>>) => CircomProof;
    /**
     * Create a frozen instance of {@link CircomProof}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<CircomProof> & Required<Omit<CircomProof, never>>) => CircomProof;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<CircomProof>;
}>;
export type CircomProofResult = {
    proof: CircomProof;
    inputs: Array<string>;
};
/**
 * Generated factory for {@link CircomProofResult} record objects.
 */
export declare const CircomProofResult: Readonly<{
    /**
     * Create a frozen instance of {@link CircomProofResult}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<CircomProofResult> & Required<Omit<CircomProofResult, never>>) => CircomProofResult;
    /**
     * Create a frozen instance of {@link CircomProofResult}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<CircomProofResult> & Required<Omit<CircomProofResult, never>>) => CircomProofResult;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<CircomProofResult>;
}>;
export type G1 = {
    x: string;
    y: string;
    z: string;
};
/**
 * Generated factory for {@link G1} record objects.
 */
export declare const G1: Readonly<{
    /**
     * Create a frozen instance of {@link G1}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<G1> & Required<Omit<G1, never>>) => G1;
    /**
     * Create a frozen instance of {@link G1}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<G1> & Required<Omit<G1, never>>) => G1;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<G1>;
}>;
export type G2 = {
    x: Array<string>;
    y: Array<string>;
    z: Array<string>;
};
/**
 * Generated factory for {@link G2} record objects.
 */
export declare const G2: Readonly<{
    /**
     * Create a frozen instance of {@link G2}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<G2> & Required<Omit<G2, never>>) => G2;
    /**
     * Create a frozen instance of {@link G2}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<G2> & Required<Omit<G2, never>>) => G2;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<G2>;
}>;
export type Halo2ProofResult = {
    proof: ArrayBuffer;
    inputs: ArrayBuffer;
};
/**
 * Generated factory for {@link Halo2ProofResult} record objects.
 */
export declare const Halo2ProofResult: Readonly<{
    /**
     * Create a frozen instance of {@link Halo2ProofResult}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<Halo2ProofResult> & Required<Omit<Halo2ProofResult, never>>) => Halo2ProofResult;
    /**
     * Create a frozen instance of {@link Halo2ProofResult}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<Halo2ProofResult> & Required<Omit<Halo2ProofResult, never>>) => Halo2ProofResult;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<Halo2ProofResult>;
}>;
/**
 * Struct representing a proof with separated public inputs
 * Used for on-chain verification where proof and public inputs are passed separately
 */
export type ProofWithPublicInputs = {
    /**
     * The proof without public inputs (for Solidity verifier)
     */
    proof: ArrayBuffer;
    /**
     * The public inputs as an array of 32-byte values (for Solidity verifier)
     */
    publicInputs: Array<ArrayBuffer>;
    /**
     * The number of public inputs
     */
    numPublicInputs: number;
};
/**
 * Generated factory for {@link ProofWithPublicInputs} record objects.
 */
export declare const ProofWithPublicInputs: Readonly<{
    /**
     * Create a frozen instance of {@link ProofWithPublicInputs}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    create: (partial: Partial<ProofWithPublicInputs> & Required<Omit<ProofWithPublicInputs, never>>) => ProofWithPublicInputs;
    /**
     * Create a frozen instance of {@link ProofWithPublicInputs}, with defaults specified
     * in Rust, in the {@link proofport} crate.
     */
    new: (partial: Partial<ProofWithPublicInputs> & Required<Omit<ProofWithPublicInputs, never>>) => ProofWithPublicInputs;
    /**
     * Defaults specified in the {@link proofport} crate.
     */
    defaults: () => Partial<ProofWithPublicInputs>;
}>;
export declare enum MoproError_Tags {
    CircomError = "CircomError",
    Halo2Error = "Halo2Error",
    NoirError = "NoirError"
}
export declare const MoproError: Readonly<{
    instanceOf: (obj: any) => obj is MoproError;
    CircomError: {
        new (v0: string): {
            readonly tag: MoproError_Tags.CircomError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        "new"(v0: string): {
            readonly tag: MoproError_Tags.CircomError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        instanceOf(obj: any): obj is {
            readonly tag: MoproError_Tags.CircomError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        hasInner(obj: any): obj is {
            readonly tag: MoproError_Tags.CircomError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        getInner(obj: {
            readonly tag: MoproError_Tags.CircomError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        }): Readonly<[string]>;
        isError(error: unknown): error is Error;
        captureStackTrace(targetObject: object, constructorOpt?: Function): void;
        prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
        stackTraceLimit: number;
    };
    Halo2Error: {
        new (v0: string): {
            readonly tag: MoproError_Tags.Halo2Error;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        "new"(v0: string): {
            readonly tag: MoproError_Tags.Halo2Error;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        instanceOf(obj: any): obj is {
            readonly tag: MoproError_Tags.Halo2Error;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        hasInner(obj: any): obj is {
            readonly tag: MoproError_Tags.Halo2Error;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        getInner(obj: {
            readonly tag: MoproError_Tags.Halo2Error;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        }): Readonly<[string]>;
        isError(error: unknown): error is Error;
        captureStackTrace(targetObject: object, constructorOpt?: Function): void;
        prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
        stackTraceLimit: number;
    };
    NoirError: {
        new (v0: string): {
            readonly tag: MoproError_Tags.NoirError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        "new"(v0: string): {
            readonly tag: MoproError_Tags.NoirError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        instanceOf(obj: any): obj is {
            readonly tag: MoproError_Tags.NoirError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        hasInner(obj: any): obj is {
            readonly tag: MoproError_Tags.NoirError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        };
        getInner(obj: {
            readonly tag: MoproError_Tags.NoirError;
            readonly inner: Readonly<[string]>;
            /**
             * @private
             * This field is private and should not be used, use `tag` instead.
             */
            readonly [uniffiTypeNameSymbol]: "MoproError";
            name: string;
            message: string;
            stack?: string;
            cause?: unknown;
        }): Readonly<[string]>;
        isError(error: unknown): error is Error;
        captureStackTrace(targetObject: object, constructorOpt?: Function): void;
        prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
        stackTraceLimit: number;
    };
}>;
export type MoproError = InstanceType<typeof MoproError[keyof Omit<typeof MoproError, 'instanceOf'>]>;
export declare enum ProofLib {
    Arkworks = 0,
    Rapidsnark = 1
}
/**
 * This should be called before anything else.
 *
 * It is likely that this is being done for you by the library's `index.ts`.
 *
 * It checks versions of uniffi between when the Rust scaffolding was generated
 * and when the bindings were generated.
 *
 * It also initializes the machinery to enable Rust to talk back to Javascript.
 */
declare function uniffiEnsureInitialized(): void;
declare const _default: Readonly<{
    initialize: typeof uniffiEnsureInitialized;
    converters: {
        FfiConverterTypeCircomProof: {
            read(from: RustBuffer): CircomProof;
            write(value: CircomProof, into: RustBuffer): void;
            allocationSize(value: CircomProof): number;
            lift(value: UniffiByteArray): CircomProof;
            lower(value: CircomProof): UniffiByteArray;
        };
        FfiConverterTypeCircomProofResult: {
            read(from: RustBuffer): CircomProofResult;
            write(value: CircomProofResult, into: RustBuffer): void;
            allocationSize(value: CircomProofResult): number;
            lift(value: UniffiByteArray): CircomProofResult;
            lower(value: CircomProofResult): UniffiByteArray;
        };
        FfiConverterTypeG1: {
            read(from: RustBuffer): G1;
            write(value: G1, into: RustBuffer): void;
            allocationSize(value: G1): number;
            lift(value: UniffiByteArray): G1;
            lower(value: G1): UniffiByteArray;
        };
        FfiConverterTypeG2: {
            read(from: RustBuffer): G2;
            write(value: G2, into: RustBuffer): void;
            allocationSize(value: G2): number;
            lift(value: UniffiByteArray): G2;
            lower(value: G2): UniffiByteArray;
        };
        FfiConverterTypeHalo2ProofResult: {
            read(from: RustBuffer): Halo2ProofResult;
            write(value: Halo2ProofResult, into: RustBuffer): void;
            allocationSize(value: Halo2ProofResult): number;
            lift(value: UniffiByteArray): Halo2ProofResult;
            lower(value: Halo2ProofResult): UniffiByteArray;
        };
        FfiConverterTypeMoproError: {
            read(from: RustBuffer): MoproError;
            write(value: MoproError, into: RustBuffer): void;
            allocationSize(value: MoproError): number;
            lift(value: UniffiByteArray): MoproError;
            lower(value: MoproError): UniffiByteArray;
        };
        FfiConverterTypeProofLib: {
            read(from: RustBuffer): ProofLib;
            write(value: ProofLib, into: RustBuffer): void;
            allocationSize(value: ProofLib): number;
            lift(value: UniffiByteArray): ProofLib;
            lower(value: ProofLib): UniffiByteArray;
        };
        FfiConverterTypeProofWithPublicInputs: {
            read(from: RustBuffer): ProofWithPublicInputs;
            write(value: ProofWithPublicInputs, into: RustBuffer): void;
            allocationSize(value: ProofWithPublicInputs): number;
            lift(value: UniffiByteArray): ProofWithPublicInputs;
            lower(value: ProofWithPublicInputs): UniffiByteArray;
        };
    };
}>;
export default _default;
//# sourceMappingURL=proofport.d.ts.map