import { ArtifactClient, Location } from '@ultrasa/mini-cloud-models';

export interface ArtifactHandler extends ArtifactClient {}

export interface ArtifactReferenceBuilder<T extends Location> {
  generateRawLocation(artifactType: string, artifactName: string): Promise<string>;
  deleteArtifact(location: T): Promise<void>;
  batchDeleteArtifacts(rawLocations: string[]): Promise<void>;
  convertRawLocationToLocation(rawLocation: string, mode: 'upload' | 'download'): Promise<Location>;
}
