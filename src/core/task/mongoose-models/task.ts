import mongoose from 'mongoose';
import { InternalTask } from '../internal-models';

export interface InternalTaskDoc extends InternalTask, mongoose.Document {}

const InternalTaskSchemaDef: mongoose.Schema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    type: {
      type: String,
      required: true,
    },
    cmd: {
      type: String,
      required: true,
    },
    cwd: {
      type: String,
      required: true,
    },
    stdout: {
      type: String,
      required: false,
    },
    stderr: {
      type: String,
      required: false,
    },
    firstLaunchAt: {
      type: Number,
      required: false,
    },
    duration: {
      type: Number,
      required: false,
    },
    blob: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

InternalTaskSchemaDef.index({ taskId: 1 }, { unique: false });
InternalTaskSchemaDef.index({ taskId: 1, version: 1 }, { unique: true });

export default mongoose.model<InternalTaskDoc>('TaskV2', InternalTaskSchemaDef);
