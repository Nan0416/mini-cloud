import { InternalArtifactMetadata } from './internal-models';
import { ArtifactMetadata } from '@ultrasa/mini-cloud-models';

export type ArtifactMetadataWithRawLocation = Omit<ArtifactMetadata, 'location'> & { readonly rawLocation: string };

export interface ArtifactMetadataDao {
  getArtifactMetadata(artifactType: string, artifactName: string): Promise<ArtifactMetadataWithRawLocation | undefined>;

  deleteArtifactMetadata(artifactType: string, artifactName: string): Promise<void>;

  createArtifactMetadata(internalArtifactMetadata: InternalArtifactMetadata): Promise<void>;

  listArtifactMetadatasByTimeWindow(artifactType: string, startTime?: string, endTime?: string): Promise<ArtifactMetadataWithRawLocation[]>;

  batchDeleteArtifactMetadatas(artifactType: string, startTime?: string, endTime?: string): Promise<void>;
}
