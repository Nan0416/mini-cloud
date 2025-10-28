import mongoose from 'mongoose';
import { InternalTaskEvent } from '../internal-models';
import { TTL_IN_SECOND } from './constants';

export interface InternalTaskEventDoc extends InternalTaskEvent, mongoose.Document {}

const InternalTaskEventSchemaDef: mongoose.Schema = new mongoose.Schema<InternalTaskEvent>({
  instanceId: {
    type: String,
    required: true,
    index: true,
  },
  eventId: {
    type: String,
    required: true,
    unique: true,
  },
  source: {
    type: String,
    require: true,
  },
  timestamp: {
    type: Date,
    required: true,
  },
  level: {
    type: String,
    required: true,
  },
  format: {
    type: String,
    required: true,
  },
  payload: {
    type: String,
    required: true,
  },
});

InternalTaskEventSchemaDef.index({ timestamp: 1 }, { expireAfterSeconds: TTL_IN_SECOND });

/**
 * Keep calling the collection MetricReference for backward compatibility.
 */
export default mongoose.model<InternalTaskEventDoc>('TaskEvent', InternalTaskEventSchemaDef);
