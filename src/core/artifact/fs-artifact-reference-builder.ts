import { ArtifactReferenceBuilder } from './artifact-handler';
import { FsLocation, Location } from '@ultrasa/mini-cloud-models';

export class FsArtifactReferenceBuilder implements ArtifactReferenceBuilder<FsLocation> {
  generateRawLocation(artifactType: string, artifactName: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
  deleteArtifact(location: FsLocation): Promise<void> {
    throw new Error('Method not implemented.');
  }
  batchDeleteArtifacts(rawLocations: string[]): Promise<void> {
    throw new Error('Method not implemented.');
  }
  convertRawLocationToLocation(rawLocation: string, mode: 'upload' | 'download'): Promise<Location> {
    throw new Error('Method not implemented.');
  }
}
