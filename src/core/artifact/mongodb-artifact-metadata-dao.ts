import { LoggerFactory } from '@ultrasa/dev-kit';
import { InternalArtifactMetadata } from './internal-models';
import ArtifactMetadataSchema from './mongoose-models/artifact-metadata';
import { ArtifactMetadataDao, ArtifactMetadataWithRawLocation } from './artifact-metadata-dao';
import { InternalServiceError, StorageType } from '@ultrasa/mini-cloud-models';

interface Timestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const logger = LoggerFactory.getLogger('MongoDBArtifactMetadataStore');

/**
 * MongoDBArtifactMetadataStore is a read only database, the primary key used to identify an artifact is
 * the combination of artifact type and artifact name.
 *
 * The implementation is aware of the storage type, and expire the item based on the storage type. For example,
 * s3_3months item will expire after 3 month. The actual artifact is expired by the storage media, such as the s3 bucket lifecycle rule.
 *
 */
export class MongoDBArtifactMetadataDao implements ArtifactMetadataDao {
  constructor() {}

  async getArtifactMetadata(artifactType: string, artifactName: string): Promise<ArtifactMetadataWithRawLocation | undefined> {
    logger.info(`Mongodb queries ${artifactType} ${artifactName} artifact metadata`);

    const result = await ArtifactMetadataSchema.findOne({
      artifactType,
      artifactName,
    }).exec();
    if (result) {
      return this.convertInternalArtifactMetadataToArtifactMetadata(result.toObject<InternalArtifactMetadata & Timestamps>());
    } else {
      logger.info(`unable to find ${artifactType} ${artifactName} artifact metadata`);
      return undefined;
    }
  }

  async deleteArtifactMetadata(artifactType: string, artifactName: string): Promise<void> {
    logger.info(`Mongodb queries ${artifactType} ${artifactName} artifact metadata`);
    await ArtifactMetadataSchema.deleteOne({ artifactType, artifactName });
  }

  async createArtifactMetadata(internalArtifactMetadata: InternalArtifactMetadata): Promise<void> {
    logger.info(`Mongodb creates artifact metadata ${JSON.stringify(internalArtifactMetadata)}`);

    try {
      await ArtifactMetadataSchema.create(internalArtifactMetadata);
    } catch (err: any) {
      if (err.name === 'MongoError' && err.code === 11000) {
        const message = `${internalArtifactMetadata.artifactType} ${internalArtifactMetadata.artifactName} artifact metadata alreadt existed`;
        logger.warn(message);
        // caller, we guarantee, it doesn't exist.
        throw new InternalServiceError(message);
      }
      throw err;
    }
  }

  async listArtifactMetadatasByTimeWindow(artifactType: string, startTime?: string, endTime?: string): Promise<ArtifactMetadataWithRawLocation[]> {
    logger.info(`Mongodb lists artifact metadata by time window ${artifactType} from ${startTime ?? 'beginning'} to ${endTime ?? 'now'}`);

    const query: any = { artifactType: artifactType };
    if (typeof startTime === 'string' || typeof endTime === 'string') {
      query['createdAt'] = {};
      if (typeof startTime === 'string') {
        query['createdAt']['$gte'] = new Date(startTime);
      }
      if (typeof endTime === 'string') {
        query['createdAt']['$lte'] = new Date(endTime);
      }
    }

    const metadatas = await ArtifactMetadataSchema.find(query).exec();
    logger.info(`Found ${metadatas.length} items.`);
    const results = metadatas.map((doc) => this.convertInternalArtifactMetadataToArtifactMetadata(doc.toObject<InternalArtifactMetadata & Timestamps>()));
    return results;
  }

  async batchDeleteArtifactMetadatas(artifactType: string, startTime?: string, endTime?: string): Promise<void> {
    logger.info(`Mongodb batch delete artifact metadata by time window ${artifactType} from ${startTime ?? 'beginning'} to ${endTime ?? 'now'}`);

    const query: any = { artifactType: artifactType };
    if (typeof startTime === 'string' || typeof endTime === 'string') {
      query['createdAt'] = {};
      if (typeof startTime === 'string') {
        query['createdAt']['$gte'] = new Date(startTime);
      }
      if (typeof endTime === 'string') {
        query['createdAt']['$lte'] = new Date(endTime);
      }
    }
    await ArtifactMetadataSchema.deleteMany(query).exec();
  }

  private convertInternalArtifactMetadataToArtifactMetadata(internalArtifactMetadata: InternalArtifactMetadata & Timestamps): ArtifactMetadataWithRawLocation {
    return {
      artifactType: internalArtifactMetadata.artifactType,
      artifactName: internalArtifactMetadata.artifactName,
      createdAt: internalArtifactMetadata.createdAt.toISOString(),
      updatedAt: internalArtifactMetadata.updatedAt.toISOString(),
      storageType: internalArtifactMetadata.storageType as StorageType, // assert storage type?
      rawLocation: internalArtifactMetadata.rawLocation,
      description: internalArtifactMetadata.description,
      expireAt: internalArtifactMetadata.expireAt?.toISOString(),
    };
  }
}
