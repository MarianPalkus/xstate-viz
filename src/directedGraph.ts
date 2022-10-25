import type { ElkExtendedEdge } from 'elkjs';
import { StateNode, TransitionDefinition } from 'xstate';
import { flatten } from 'xstate/lib/utils';
import { Point } from './pathUtils';
import { getChildren } from './utils';

export type DirectedGraphLabel = {
  text: string;
  x: number;
  y: number;
};
export type DirectedGraphPort = {
  id: string;
};
export type DirectedGraphEdgeConfig = {
  id: string;
  source: StateNode;
  target: StateNode;
  label: DirectedGraphLabel;
  transition: TransitionDefinition<any, any>;
  sections: ElkExtendedEdge['sections'];
};
export type DirectedGraphNodeConfig = {
  id: string;
  stateNode: StateNode;
  children: DirectedGraphNode[];
  ports: DirectedGraphPort[];
  /**
   * The edges representing all transitions from this `stateNode`.
   */
  edges: DirectedGraphEdge[];
};

export class DirectedGraphNode {
  public id: string;
  public data: StateNode;
  public children: DirectedGraphNode[];
  public ports: DirectedGraphPort[];
  public edges: DirectedGraphEdge[];

  /**
   * The position of the graph node (relative to parent)
   * and its dimensions
   */
  public layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /**
   * Gets the absolute position of the graph node
   */
  public get absolute(): Point | undefined {
    if (!this.parent) {
      return this.layout;
    }

    if (!this.layout) {
      return undefined;
    }

    return {
      x: this.layout.x + this.parent.absolute!.x,
      y: this.layout.y + this.parent.absolute!.y,
    };
  }

  constructor(
    config: DirectedGraphNodeConfig,
    public parent?: DirectedGraphNode,
  ) {
    this.id = config.id;
    this.data = config.stateNode;
    this.children = config.children;
    this.children.forEach((child) => {
      child.parent = this;
    });
    this.ports = config.ports;
    this.edges = config.edges.map((edgeConfig) => {
      return new DirectedGraphEdge(edgeConfig);
    });
  }

  public get level(): number {
    return (this.parent?.level ?? -1) + 1;
  }
}

export class DirectedGraphEdge {
  public id: string;
  public source: StateNode;
  public target: StateNode;
  public label: DirectedGraphLabel;
  public transition: TransitionDefinition<any, any>;
  public sections: ElkExtendedEdge['sections'];
  constructor(config: DirectedGraphEdgeConfig) {
    this.id = config.id;
    this.source = config.source;
    this.target = config.target;
    this.label = config.label;
    this.transition = config.transition;
    this.sections = config.sections;
  }
}

function getStateNodeLevel(stateNode: StateNode): number {
  let currentNode: StateNode | undefined = stateNode
  let currentLevel = 0
  while (currentNode?.parent) {
    currentNode = currentNode.parent
    currentLevel++
  }
  return currentLevel
}

function getStateNodeParentAtLevel(stateNode: StateNode, targetLevel: number): StateNode | undefined {
  let currentNode: StateNode | undefined = stateNode
  let currentLevel = getStateNodeLevel(stateNode)
  while (targetLevel < currentLevel && currentNode?.parent) {
    currentNode = currentNode.parent
    currentLevel--
  }

  return currentNode
}

function getChildEdgesRecursively(childGraph: DirectedGraphNode): DirectedGraphEdge[] {
  return flatten(
    [
      childGraph.edges,
      ...childGraph.children.map(getChildEdgesRecursively)
    ]
  )
}

function getCollapsedParentNode(stateNode: StateNode, userUIPreferences: UserUIPreferences): StateNode | undefined {
  let currentNode: StateNode | undefined = stateNode

  while (currentNode?.parent) {
    currentNode = currentNode.parent

    if (userUIPreferences.graphCollapseMap[currentNode?.id] === "collapsed") {
      return currentNode
    }
  }

  return undefined
}

export interface UserUIPreferences {
  readonly graphCollapseMap: { [nodeId: string]: "collapsed" | undefined }
  readonly graphLayout?: {
    readonly layeredAlgorithmWrapping?: "MULTI_EDGE" | "NONE"
    readonly mergeEdges?: boolean
  }
}
export function toDirectedGraph(stateNode: StateNode, userUIPreferences: UserUIPreferences): DirectedGraphNode {
  const isNodeCollapsed = userUIPreferences.graphCollapseMap[stateNode.id] === "collapsed" //stateNodeLevel === 1 && stateNode.id !== "parentMachine.not started"

  const edges: DirectedGraphEdge[] = flatten(
    stateNode.transitions.map((t, transitionIndex) => {
      const targets = t.target ? t.target : [stateNode];

      return targets
        .map((target, targetIndex) => {
          const edge = new DirectedGraphEdge({
            id: `${stateNode.id}:${transitionIndex}:${targetIndex}`,
            source: stateNode,
            target: target!,
            transition: t,
            label: {
              text: t.eventType,
              x: 0,
              y: 0,
            },
            sections: [],
          });

          return edge;
        });
    }),
  );

  if (isNodeCollapsed) {
    const childrenGraphs = getChildren(stateNode).map((sn) => toDirectedGraph(sn, userUIPreferences))

    const childEdges = flatten(
      childrenGraphs.map(getChildEdgesRecursively)
    )

    const allTransformedEdges = [...edges, ...childEdges]
      .map(edge => {
        let transformedEdge = {
          ...edge
        }
        const isSourceCollapsed = userUIPreferences.graphCollapseMap[edge.source.id] === "collapsed"
        const edgeSourceCollapsedParentNode = getCollapsedParentNode(edge.source, userUIPreferences)
        const shouldTransformSourceNode = !isSourceCollapsed && !!edgeSourceCollapsedParentNode
        if (shouldTransformSourceNode) {
          transformedEdge = {
            ...transformedEdge,
            source: edgeSourceCollapsedParentNode
          }
        }

        const isTargetCollapsed = userUIPreferences.graphCollapseMap[edge.target.id] === "collapsed"
        const edgeTargetCollapsedParentNode = getCollapsedParentNode(edge.target, userUIPreferences)
        const shouldTransformTargetNode = !isTargetCollapsed && !!edgeTargetCollapsedParentNode
        if (shouldTransformTargetNode) {
          transformedEdge = {
            ...transformedEdge,
            target: edgeTargetCollapsedParentNode,
          }
        }

        if ((shouldTransformSourceNode || shouldTransformTargetNode) && transformedEdge.source == transformedEdge.target) {
          return undefined // TODO: workaround to not include "internal" edges of collapsed nodes
        }

        return transformedEdge
      })
      .filter(edge => edge !== undefined) // TODO: workaround to not include "internal" edges of collapsed nodes
      .map(edge => edge!) // TODO: workaround to not include "internal" edges of collapsed nodes

    const graph = new DirectedGraphNode({
      id: stateNode.id,
      stateNode,
      children: [],
      edges: allTransformedEdges,
      ports: [],
    });
    return graph
  }

  const graph = new DirectedGraphNode({
    id: stateNode.id,
    stateNode,
    children: getChildren(stateNode).map((sn) => toDirectedGraph(sn, userUIPreferences)),
    edges,
    ports: [],
  });

  return graph;
}

export function getAllNodes(
  rootNode: DirectedGraphNode,
): Array<DirectedGraphNode> {
  if (!rootNode.children.length) {
    return [rootNode];
  }

  return [rootNode].concat(rootNode.children.map(getAllNodes).flat());
}

export type DigraphBackLinkMap = Map<StateNode, Set<DirectedGraphEdge>>;

export function getBackLinkMap(digraph: DirectedGraphNode): DigraphBackLinkMap {
  const nodes = getAllNodes(digraph);
  const backLinkMap: DigraphBackLinkMap = new Map();

  const addMapping = (node: StateNode, edge: DirectedGraphEdge): void => {
    if (!backLinkMap.get(node)) {
      backLinkMap.set(node, new Set());
    }

    backLinkMap.get(node)!.add(edge);
  };

  nodes.forEach((node) => {
    node.edges.forEach((edge) => {
      addMapping(edge.target, edge);
    });
  });

  return backLinkMap;
}
