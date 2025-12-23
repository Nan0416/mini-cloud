import mongoose from 'mongoose';
import { InternalArtifactMetadata } from '../internal-models';

export interface InternalArtifactMetadataDoc extends InternalArtifactMetadata, mongoose.Document {}

const ArtifactMetadataDocSchemaDef: mongoose.Schema = new mongoose.Schema(
  {
    artifactType: {
      type: String,
      required: true,
    },
    artifactName: {
      type: String,
      required: true,
    },
    storageType: {
      type: String,
      required: true,
    },
    rawLocation: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    expireAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

ArtifactMetadataDocSchemaDef.index({ artifactType: 1, artifactName: 1 }, { unique: true });
ArtifactMetadataDocSchemaDef.index({ artifactType: 1, createdAt: 1 });

export default mongoose.model<InternalArtifactMetadataDoc>('ArtifactMetadata', ArtifactMetadataDocSchemaDef);
