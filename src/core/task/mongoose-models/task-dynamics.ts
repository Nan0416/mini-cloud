import mongoose from 'mongoose';
import { InternalTaskDynamics } from '../internal-models';

export interface InternalTaskDynamicsDoc extends InternalTaskDynamics, mongoose.Document {}

const InternalTaskDynamicsSchemaDef: mongoose.Schema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  active: {
    type: Boolean,
    required: true,
  },
  targetAgentIds: {
    type: [String],
    require: true,
  },
});

export default mongoose.model<InternalTaskDynamicsDoc>('TaskDynamicsV2', InternalTaskDynamicsSchemaDef);
