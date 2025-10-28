import mongoose from 'mongoose';
import { InternalLatestTaskId } from '../internal-models';

export interface InternalLatestTaskIdDoc extends InternalLatestTaskId, mongoose.Document {}

const InternalLatestTaskIdSchemaDef: mongoose.Schema = new mongoose.Schema<InternalLatestTaskId>({
  taskId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  version: {
    type: Number,
    required: true,
  },
});

export default mongoose.model<InternalLatestTaskIdDoc>('LatestTaskId', InternalLatestTaskIdSchemaDef);
