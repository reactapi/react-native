/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';
import type {
  PropTypeAnnotation,
  EventTypeShape,
  ComponentShape,
} from '../../CodegenSchema';

const j = require('jscodeshift');

import type {SchemaType} from '../../CodegenSchema';

// File path -> contents
type FilesOutput = Map<string, string>;

const FileTemplate = ({
  imports,
  componentConfig,
}: {
  imports: string,
  componentConfig: string,
}) => `
/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * @flow
 *
 * ${'@'}generated by codegen project: GenerateViewConfigJs.js
 */

'use strict';

${imports}

${componentConfig}
`;

// We use this to add to a set. Need to make sure we aren't importing
// this multiple times.
const UIMANAGER_IMPORT = 'const {UIManager} = require("react-native")';

function getReactDiffProcessValue(typeAnnotation: PropTypeAnnotation) {
  switch (typeAnnotation.type) {
    case 'BooleanTypeAnnotation':
    case 'StringTypeAnnotation':
    case 'Int32TypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'ObjectTypeAnnotation':
    case 'StringEnumTypeAnnotation':
    case 'Int32EnumTypeAnnotation':
      return j.literal(true);
    case 'ReservedPropTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'ColorPrimitive':
          return j.template
            .expression`{ process: require('react-native/Libraries/StyleSheet/processColor') }`;
        case 'ImageSourcePrimitive':
          return j.template
            .expression`{ process: require('react-native/Libraries/Image/resolveAssetSource') }`;
        case 'PointPrimitive':
          return j.template
            .expression`{ diff: require('react-native/Libraries/Utilities/differ/pointsDiffer') }`;
        case 'EdgeInsetsPrimitive':
          return j.template
            .expression`{ diff: require('react-native/Libraries/Utilities/differ/insetsDiffer') }`;
        default:
          (typeAnnotation.name: empty);
          throw new Error(
            `Received unknown native typeAnnotation: "${typeAnnotation.name}"`,
          );
      }
    case 'ArrayTypeAnnotation':
      if (typeAnnotation.elementType.type === 'ReservedPropTypeAnnotation') {
        switch (typeAnnotation.elementType.name) {
          case 'ColorPrimitive':
            return j.template
              .expression`{ process: require('react-native/Libraries/StyleSheet/processColorArray') }`;
          case 'ImageSourcePrimitive':
            return j.literal(true);
          case 'PointPrimitive':
            return j.literal(true);
          default:
            throw new Error(
              `Received unknown array native typeAnnotation: "${typeAnnotation.elementType.name}"`,
            );
        }
      }
      return j.literal(true);
    default:
      (typeAnnotation: empty);
      throw new Error(
        `Received unknown typeAnnotation: "${typeAnnotation.type}"`,
      );
  }
}

const ComponentTemplate = ({
  componentName,
  paperComponentName,
  paperComponentNameDeprecated,
}: {
  componentName: string,
  paperComponentName: ?string,
  paperComponentNameDeprecated: ?string,
}) => {
  const nativeComponentName = paperComponentName ?? componentName;

  return `
let nativeComponentName = '${nativeComponentName}';
${
  paperComponentNameDeprecated != null
    ? DeprecatedComponentNameCheckTemplate({
        componentName,
        paperComponentNameDeprecated,
      })
    : ''
}

export const __INTERNAL_VIEW_CONFIG = VIEW_CONFIG;

export default NativeComponentRegistry.get(nativeComponentName, () => __INTERNAL_VIEW_CONFIG);
`.trim();
};

// Check whether the native component exists in the app binary.
// Old getViewManagerConfig() checks for the existance of the native Paper view manager. Not available in Bridgeless.
// New hasViewManagerConfig() queries Fabric’s native component registry directly.
const DeprecatedComponentNameCheckTemplate = ({
  componentName,
  paperComponentNameDeprecated,
}: {
  componentName: string,
  paperComponentNameDeprecated: string,
}) =>
  `
if (UIManager.hasViewManagerConfig('${componentName}')) {
  nativeComponentName = '${componentName}';
} else if (UIManager.hasViewManagerConfig('${paperComponentNameDeprecated}')) {
  nativeComponentName = '${paperComponentNameDeprecated}';
} else {
  throw new Error('Failed to find native component for either "${componentName}" or "${paperComponentNameDeprecated}"');
}
`.trim();

// Replicates the behavior of RCTNormalizeInputEventName in RCTEventDispatcher.m
function normalizeInputEventName(name: string) {
  if (name.startsWith('on')) {
    return name.replace(/^on/, 'top');
  } else if (!name.startsWith('top')) {
    return `top${name[0].toUpperCase()}${name.slice(1)}`;
  }

  return name;
}

// Replicates the behavior of viewConfig in RCTComponentData.m
function getValidAttributesForEvents(
  events: $ReadOnlyArray<EventTypeShape>,
  imports: Set<string>,
) {
  imports.add(
    "const {ConditionallyIgnoredEventHandlers} = require('react-native/Libraries/NativeComponent/ViewConfigIgnore');",
  );

  const validAttributes = j.objectExpression(
    events.map(eventType => {
      return j.property('init', j.identifier(eventType.name), j.literal(true));
    }),
  );

  return j.callExpression(j.identifier('ConditionallyIgnoredEventHandlers'), [
    validAttributes,
  ]);
}

function generateBubblingEventInfo(
  event: EventTypeShape,
  nameOveride: void | string,
) {
  return j.property(
    'init',
    j.identifier(nameOveride || normalizeInputEventName(event.name)),
    j.objectExpression([
      j.property(
        'init',
        j.identifier('phasedRegistrationNames'),
        j.objectExpression([
          j.property(
            'init',
            j.identifier('captured'),
            j.literal(`${event.name}Capture`),
          ),
          j.property('init', j.identifier('bubbled'), j.literal(event.name)),
        ]),
      ),
    ]),
  );
}

function generateDirectEventInfo(
  event: EventTypeShape,
  nameOveride: void | string,
) {
  return j.property(
    'init',
    j.identifier(nameOveride || normalizeInputEventName(event.name)),
    j.objectExpression([
      j.property(
        'init',
        j.identifier('registrationName'),
        j.literal(event.name),
      ),
    ]),
  );
}

function buildViewConfig(
  schema: SchemaType,
  componentName: string,
  component: ComponentShape,
  imports: Set<string>,
) {
  const componentProps = component.props;
  const componentEvents = component.events;

  component.extendsProps.forEach(extendProps => {
    switch (extendProps.type) {
      case 'ReactNativeBuiltInType':
        switch (extendProps.knownTypeName) {
          case 'ReactNativeCoreViewProps':
            imports.add(
              "const NativeComponentRegistry = require('react-native/Libraries/NativeComponent/NativeComponentRegistry');",
            );

            return;
          default:
            (extendProps.knownTypeName: empty);
            throw new Error('Invalid knownTypeName');
        }
      default:
        (extendProps.type: empty);
        throw new Error('Invalid extended type');
    }
  });

  const validAttributes = j.objectExpression([
    ...componentProps.map(schemaProp => {
      return j.property(
        'init',
        j.identifier(schemaProp.name),
        getReactDiffProcessValue(schemaProp.typeAnnotation),
      );
    }),
    ...(componentEvents.length > 0
      ? [
          j.spreadProperty(
            getValidAttributesForEvents(componentEvents, imports),
          ),
        ]
      : []),
  ]);

  const bubblingEventNames = component.events
    .filter(event => event.bubblingType === 'bubble')
    .reduce((bubblingEvents, event) => {
      // We add in the deprecated paper name so that it is in the view config.
      // This means either the old event name or the new event name can fire
      // and be sent to the listener until the old top level name is removed.
      if (event.paperTopLevelNameDeprecated) {
        bubblingEvents.push(
          generateBubblingEventInfo(event, event.paperTopLevelNameDeprecated),
        );
      } else {
        bubblingEvents.push(generateBubblingEventInfo(event));
      }
      return bubblingEvents;
    }, []);

  const bubblingEvents =
    bubblingEventNames.length > 0
      ? j.property(
          'init',
          j.identifier('bubblingEventTypes'),
          j.objectExpression(bubblingEventNames),
        )
      : null;

  const directEventNames = component.events
    .filter(event => event.bubblingType === 'direct')
    .reduce((directEvents, event) => {
      // We add in the deprecated paper name so that it is in the view config.
      // This means either the old event name or the new event name can fire
      // and be sent to the listener until the old top level name is removed.
      if (event.paperTopLevelNameDeprecated) {
        directEvents.push(
          generateDirectEventInfo(event, event.paperTopLevelNameDeprecated),
        );
      } else {
        directEvents.push(generateDirectEventInfo(event));
      }
      return directEvents;
    }, []);

  const directEvents =
    directEventNames.length > 0
      ? j.property(
          'init',
          j.identifier('directEventTypes'),
          j.objectExpression(directEventNames),
        )
      : null;

  const properties = [
    j.property(
      'init',
      j.identifier('uiViewClassName'),
      j.literal(componentName),
    ),
    bubblingEvents,
    directEvents,
    j.property('init', j.identifier('validAttributes'), validAttributes),
  ].filter(Boolean);

  return j.objectExpression(properties);
}

function buildCommands(
  schema: SchemaType,
  componentName: string,
  component: ComponentShape,
  imports: Set<string>,
) {
  const commands = component.commands;

  if (commands.length === 0) {
    return null;
  }

  imports.add(
    'const {dispatchCommand} = require("react-native/Libraries/ReactNative/RendererProxy");',
  );

  const properties = commands.map(command => {
    const commandName = command.name;
    const params = command.typeAnnotation.params;

    const commandNameLiteral = j.literal(commandName);
    const commandNameIdentifier = j.identifier(commandName);
    const arrayParams = j.arrayExpression(
      params.map(param => {
        return j.identifier(param.name);
      }),
    );

    const expression = j.template
      .expression`dispatchCommand(ref, ${commandNameLiteral}, ${arrayParams})`;

    const functionParams = params.map(param => {
      return j.identifier(param.name);
    });

    const property = j.property(
      'init',
      commandNameIdentifier,
      j.functionExpression(
        null,
        [j.identifier('ref'), ...functionParams],
        j.blockStatement([j.expressionStatement(expression)]),
      ),
    );
    property.method = true;

    return property;
  });

  return j.exportNamedDeclaration(
    j.variableDeclaration('const', [
      j.variableDeclarator(
        j.identifier('Commands'),
        j.objectExpression(properties),
      ),
    ]),
  );
}

module.exports = {
  generate(libraryName: string, schema: SchemaType): FilesOutput {
    try {
      const fileName = `${libraryName}NativeViewConfig.js`;
      const imports: Set<string> = new Set();

      const moduleResults = Object.keys(schema.modules)
        .map(moduleName => {
          const module = schema.modules[moduleName];
          if (module.type !== 'Component') {
            return;
          }

          const {components} = module;

          return Object.keys(components)
            .map((componentName: string) => {
              const component = components[componentName];

              if (component.paperComponentNameDeprecated) {
                imports.add(UIMANAGER_IMPORT);
              }

              const replacedTemplate = ComponentTemplate({
                componentName,
                paperComponentName: component.paperComponentName,
                paperComponentNameDeprecated:
                  component.paperComponentNameDeprecated,
              });

              const replacedSourceRoot = j.withParser('flow')(replacedTemplate);

              const paperComponentName =
                component.paperComponentName ?? componentName;

              replacedSourceRoot
                .find(j.Identifier, {
                  name: 'VIEW_CONFIG',
                })
                .replaceWith(
                  buildViewConfig(
                    schema,
                    paperComponentName,
                    component,
                    imports,
                  ),
                );

              const commands = buildCommands(
                schema,
                paperComponentName,
                component,
                imports,
              );
              if (commands) {
                replacedSourceRoot
                  .find(j.ExportDefaultDeclaration)
                  .insertAfter(j(commands).toSource());
              }

              const replacedSource: string = replacedSourceRoot.toSource({
                quote: 'single',
                trailingComma: true,
              });

              return replacedSource;
            })
            .join('\n\n');
        })
        .filter(Boolean)
        .join('\n\n');

      const replacedTemplate = FileTemplate({
        componentConfig: moduleResults,
        imports: Array.from(imports).sort().join('\n'),
      });

      return new Map([[fileName, replacedTemplate]]);
    } catch (error) {
      console.error(`\nError parsing schema for ${libraryName}\n`);
      console.error(JSON.stringify(schema));
      throw error;
    }
  },
};
