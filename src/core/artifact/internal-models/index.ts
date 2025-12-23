export interface InternalArtifactMetadata {
  readonly artifactType: string;
  readonly artifactName: string;
  readonly storageType: string;
  readonly rawLocation: string;
  readonly expireAt?: Date;
  readonly description?: string;
}
