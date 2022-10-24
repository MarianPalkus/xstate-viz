import { assign, DoneInvokeEvent } from 'xstate';
import { createModel } from 'xstate/lib/model';
import { DirectedGraphNode, UserUIPreferences } from './directedGraph';
import { getElkGraph, StateElkNode } from './graphUtils';

export const createElkMachine = (digraph: DirectedGraphNode, userViewPreferences: UserUIPreferences) => {
  const elkModel = createModel(
    {
      digraph,
      elkGraph: undefined as StateElkNode | undefined,
    },
    {
      events: {
        GRAPH_UPDATED: (digraph: DirectedGraphNode) => ({ digraph }),
      },
    },
  );

  return elkModel.createMachine({
    context: elkModel.initialContext,
    initial: 'loading',
    states: {
      loading: {
        entry: 'notifyLayoutPending',
        invoke: {
          src: (ctx) => getElkGraph(ctx.digraph, userViewPreferences),
          onDone: {
            target: 'success',
            actions: [
              assign({
                elkGraph: (_, e: DoneInvokeEvent<any>) => e.data,
              }),
              'notifyLayoutReady',
            ],
          },
        },
      },
      success: {
        on: {
          GRAPH_UPDATED: {
            target: 'loading',
            actions: [
              elkModel.assign({
                digraph: (_, e) => e.digraph,
              }),
            ],
          },
        },
      },
    },
  });
};
