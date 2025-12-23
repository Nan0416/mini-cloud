import { LoggerFactory } from '@ultrasa/dev-kit';
import { ArtifactMetadataDao, ArtifactMetadataWithRawLocation } from './artifact-metadata-dao';
import {
  ArtifactMetadata,
  BatchListArtifactMetadatasRequest,
  BatchDeleteArtifactsRequest,
  DeleteArtifactRequest,
  DeleteArtifactResponse,
  StorageType,
  BatchDeleteArtifactsResponse,
  HasArtifactRequest,
  HasArtifactResponse,
  Location,
  GetArtifactMetadataRequest,
  GetArtifactMetadataResponse,
  ArtifactNotFoundError,
  BatchListArtifactMetadatasResponse,
  CreateArtifactRequest,
  CreateArtifactResponse,
  DuplicateArtifactError,
  InternalServiceError,
} from '@ultrasa/mini-cloud-models';
import { MongoDBArtifactMetadataDao } from './mongodb-artifact-metadata-dao';
import * as lodash from 'lodash';
import { ArtifactHandler, ArtifactReferenceBuilder } from './artifact-handler';

const logger = LoggerFactory.getLogger('ArtifactStoreImpl');

/**
 * Manage artifact metadata and artifact reference, provide functions including,
 * 1. delete artifact, including its metadata and artifact content
 * 2. create artifact container and return upload reference
 * 3. list artifact metadatas
 *
 * the implementation also allows override an existing artifact.
 */
export class ArtifactHandlerImpl implements ArtifactHandler {
  private readonly storageTypeToReferenceBuilder: Map<StorageType, ArtifactReferenceBuilder<any>>;
  private readonly artifactMetadataStore: ArtifactMetadataDao;

  constructor(storageTypeToReferenceBuilder: Map<StorageType, ArtifactReferenceBuilder<any>>) {
    this.storageTypeToReferenceBuilder = storageTypeToReferenceBuilder;
    this.artifactMetadataStore = new MongoDBArtifactMetadataDao();
  }

  async deleteArtifact(request: DeleteArtifactRequest): Promise<DeleteArtifactResponse> {
    logger.info(`Delete artifact ${request.artifactType} ${request.artifactName}.`);

    const artifactMetadata = await this.artifactMetadataStore.getArtifactMetadata(request.artifactType, request.artifactName);
    if (artifactMetadata) {
      await this._deleteArtifact(artifactMetadata);
    } else {
      // e.g. due to bad user input
      logger.info(`Cannot find artifact ${request.artifactType} ${request.artifactName} metadata.`);
    }
    return {};
  }

  async batchDeleteArtifacts(request: BatchDeleteArtifactsRequest): Promise<BatchDeleteArtifactsResponse> {
    logger.info(
      `Batch delete artifact ${request.artifactType} from ${request.from ? new Date(request.from).toISOString() : 'beginning'} to ${request.to ? new Date(request.to).toISOString() : 'now'}`,
    );

    const artifactMetadatas = await this.artifactMetadataStore.listArtifactMetadatasByTimeWindow(request.artifactType, request.from, request.to);
    logger.info(`Found ${artifactMetadatas.length} metadatas.`);
    const groupByStorageType = lodash.groupBy(artifactMetadatas, (metadata) => metadata.storageType);

    for (let [storageType, metadatas] of Object.entries(groupByStorageType)) {
      logger.info(`Processing ${storageType} storage type, it has ${metadatas.length} metadatas.`);
      const referenceBulder = this.getReferenceBuilder(storageType as StorageType);
      await referenceBulder.batchDeleteArtifacts(metadatas.map((m) => m.rawLocation));
    }
    logger.info(`Successfully delete artifact objects, now delete metadata.`);
    await this.artifactMetadataStore.batchDeleteArtifactMetadatas(request.artifactType, request.from, request.to);
    return {};
  }

  private async _deleteArtifact(metadata: ArtifactMetadataWithRawLocation): Promise<void> {
    const referenceBulder = this.getReferenceBuilder(metadata.storageType);
    await referenceBulder.deleteArtifact(metadata.rawLocation);
    await this.artifactMetadataStore.deleteArtifactMetadata(metadata.artifactType, metadata.artifactName);
  }

  async hasArtifact(request: HasArtifactRequest): Promise<HasArtifactResponse> {
    logger.info(`Check if artifact ${request.artifactType} ${request.artifactName} exist.`);
    const metadata = await this.artifactMetadataStore.getArtifactMetadata(request.artifactType, request.artifactName);
    return {
      has: metadata !== undefined,
    };
  }

  async getArtifactMetadata(request: GetArtifactMetadataRequest): Promise<GetArtifactMetadataResponse> {
    logger.info(`Get artifact metadata ${request.artifactType} ${request.artifactName}.`);
    const metadataWithRawLocation = await this.artifactMetadataStore.getArtifactMetadata(request.artifactType, request.artifactName);
    if (metadataWithRawLocation === undefined) {
      const message = `${request.artifactType} ${request.artifactName} doesn't exist.`;
      logger.warn(message);
      throw new ArtifactNotFoundError(message);
    }
    return {
      artifactMetadata: await this.convertToArtifactMetadata(metadataWithRawLocation, request.withLocation),
    };
  }

  async listArtifactMetadataByTimeWindow(request: BatchListArtifactMetadatasRequest): Promise<BatchListArtifactMetadatasResponse> {
    logger.info(`List artifact metadata by time window ${request.artifactType} from ${request.from ?? 'beginning'} to ${request.to ?? 'now'}`);
    const metadatas = await this.artifactMetadataStore.listArtifactMetadatasByTimeWindow(request.artifactType, request.from, request.to);
    logger.info(`Return ${metadatas.length} artifact metadatas.`);

    const artifactMetadatas: ArtifactMetadata[] = [];
    for (let i = 0; i < metadatas.length; i++) {
      artifactMetadatas.push(await this.convertToArtifactMetadata(metadatas[i], request.withLocation));
    }
    return {
      artifactMetadatas: artifactMetadatas,
    };
  }

  private async convertToArtifactMetadata(metadata: ArtifactMetadataWithRawLocation, withLocation?: boolean): Promise<ArtifactMetadata> {
    let location: Location | undefined = undefined;
    if (withLocation) {
      const referenceBuilder = this.getReferenceBuilder(metadata.storageType);
      location = await referenceBuilder.convertRawLocationToLocation(metadata.rawLocation, 'download');
    }

    const { rawLocation, ...result } = {
      ...metadata,
      location: location,
    };
    return result;
  }

  async createArtifact(request: CreateArtifactRequest): Promise<CreateArtifactResponse> {
    logger.info(`Create artifact container by request ${request.artifactType} ${request.artifactName}.`);

    const metadata = await this.artifactMetadataStore.getArtifactMetadata(request.artifactType, request.artifactName);
    if (metadata) {
      const message = `${request.artifactType} ${request.artifactName} already existed`;
      logger.warn(message);
      throw new DuplicateArtifactError(message);
    }

    const referenceBuilder = this.getReferenceBuilder(request.storageType);

    const rawLocation = await referenceBuilder.generateRawLocation(request.artifactType, request.artifactName);

    await this.artifactMetadataStore.createArtifactMetadata({
      artifactType: request.artifactType,
      artifactName: request.artifactName,
      storageType: request.storageType,
      rawLocation: rawLocation,
      description: request.description,
      expireAt: typeof request.expireAt === 'string' ? new Date(request.expireAt) : undefined,
    });

    const location = await referenceBuilder.convertRawLocationToLocation(rawLocation, 'upload');
    return {
      location: location,
    };
  }

  private getReferenceBuilder(storageType: StorageType) {
    const referenceBuilder = this.storageTypeToReferenceBuilder.get(storageType);
    if (referenceBuilder) {
      return referenceBuilder;
    }
    const message = `Can't find reference builder for storage type ${storageType}.`;
    logger.warn(message);
    throw new InternalServiceError(message);
  }
}
