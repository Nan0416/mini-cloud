import mongoose from 'mongoose';
import { InternalTaskInstance } from '../internal-models';
import { TTL_IN_SECOND } from './constants';

export interface InternalTaskInstanceDoc extends InternalTaskInstance, mongoose.Document {}

const InternalTaskInstanceSchemaDef: mongoose.Schema = new mongoose.Schema(
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
      index: true,
    },
    version: {
      type: Number,
      required: true,
    },
    agentId: {
      type: String,
      required: true,
      // index: true, create index when it has a large number of agents.
    },
    pid: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// not unique.
InternalTaskInstanceSchemaDef.index({ taskId: 1, version: 1 });
InternalTaskInstanceSchemaDef.index({ status: 1 });
// expire only when status is terminated, exit(0), exit(-1)...
InternalTaskInstanceSchemaDef.index({ updatedAt: 1 }, { expireAfterSeconds: TTL_IN_SECOND });

export default mongoose.model<InternalTaskInstanceDoc>('TaskInstanceV2', InternalTaskInstanceSchemaDef);
