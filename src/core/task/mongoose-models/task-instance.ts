import mongoose from 'mongoose';
import { InternalTaskInstance } from '../internal-models';
import { TTL_IN_SECOND } from './constants';

export interface InternalTaskInstanceDoc extends InternalTaskInstance, mongoose.Document {}

const InternalTaskInstanceSchemaDef: mongoose.Schema = new mongoose.Schema<InternalTaskInstance>(
  {
    instanceId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    taskId: {
      type: String,
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    agentId: {
      type: String,
      required: true,
    },
    pid: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

InternalTaskInstanceSchemaDef.index({ taskId: 1, version: 1 });
InternalTaskInstanceSchemaDef.index({ status: 1 });
// expire only when status is terminated, exit(0), exit(-1)...
InternalTaskInstanceSchemaDef.index({ updatedAt: 1 }, { expireAfterSeconds: TTL_IN_SECOND });

export default mongoose.model<InternalTaskInstanceDoc>('TaskInstance', InternalTaskInstanceSchemaDef);
