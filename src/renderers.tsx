import * as React from 'react';
import {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image,
  Line,
  LinearGradient,
  Link,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Svg,
  Text,
  Tspan,
  View,
} from '@react-pdf/renderer';
import { HtmlRenderer, HtmlRenderers, WrapperRenderer } from './render.js';
import { HtmlElement } from './parse.js';
import { HtmlStyle } from './styles.js';
import { lowerAlpha, orderedAlpha, upperAlpha } from './ordered.type.js';
import { Style } from '@react-pdf/types';
import camelize from './camelize.js';
import { NodeType } from 'node-html-parser';

export const renderNoop: HtmlRenderer = ({ children }) => <></>;

export const renderPassThrough: React.FC<React.PropsWithChildren<any>> = ({
  children,
}) => children;

const convertSvgAttributes = (
  attrs: Record<string, string>
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const key in attrs) {
    result[camelize(key)] = attrs[key];
  }

  return result;
};

const convertSvgStyles = (stylesTags: Style[]): Style => {
  return stylesTags.reduce((acc, cur) => ({ ...acc, ...cur }), {});
};

export function toRoman(num: number) {
  let result = '';
  const conversationMap = new Map<number, string>([
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]);
  conversationMap.forEach((roman, decimal) => {
    let quotient: bigint = BigInt(num) / BigInt(decimal);
    num = num % decimal;
    while (quotient--) {
      result += roman;
    }
  });
  return result;
}

export const renderSvgs: WrapperRenderer = (
  Wrapper,
  { element, style, children }
) => {
  return (
    <Wrapper
      {...convertSvgAttributes(element?.attributes)}
      {...convertSvgStyles(style)}
    >
      {children}
    </Wrapper>
  );
};

export const renderBlock: HtmlRenderer = ({ style, children }) => (
  <View style={style}>{children}</View>
);

export const renderInline: HtmlRenderer = ({ style, children }) => (
  <Text style={style}>{children}</Text>
);

export const childElements = (
  element: HtmlElement,
  tagNames?: string[]
): HtmlElement[] =>
  element.childNodes.filter(
    (child) =>
      child.nodeType === NodeType.ELEMENT_NODE &&
      (!tagNames ||
        tagNames.includes((child as HtmlElement).tagName.toLowerCase()))
  ) as HtmlElement[];

export const getRows = (table: HtmlElement): HtmlElement[] => {
  let rows = childElements(table, ['tr']);

  const sections = childElements(table, ['tbody', 'thead']);
  sections.forEach((section) => {
    rows = rows.concat(childElements(section, ['tr']));
  });
  return rows;
};

export const getMaxColumns = (table: HtmlElement) => {
  if (!table) {
    return 1;
  }
  let rows = getRows(table);

  const colCounts = rows.map((row) => {
    let colCount = 0;
    childElements(row, ['td', 'th']).forEach((col) => {
      const colspan = parseInt(col.attributes.colspan, 10);
      if (isNaN(colspan)) {
        colCount++;
      } else {
        colCount += colspan;
      }
    });
    return colCount;
  });

  // const colCounts = rows.map((row) => childElements(row, ['td', 'th']).length);

  return Math.max(1, ...colCounts);
};

export const renderCell: HtmlRenderer = ({ style, element, children }) => {
  const table = element.closest('table') as HtmlElement | undefined;
  if (!table) {
    throw new Error('td element rendered outside of a table');
  }
  const tableStyles = table.style.reduce(
    (combined, tableStyle) => Object.assign(combined, tableStyle),
    {} as HtmlStyle
  );
  const baseStyles: HtmlStyle = {
    border: tableStyles.border,
    borderColor: tableStyles.borderColor,
    borderWidth: tableStyles.borderWidth,
    borderStyle: tableStyles.borderStyle,
  };
  if (
    (tableStyles as any).borderSpacing &&
    (tableStyles as any).borderCollapse !== 'collapse'
  ) {
    baseStyles.width = tableStyles.borderWidth;
    baseStyles.margin = (tableStyles as any).borderSpacing;
  } else {
    baseStyles.borderRightWidth = 0;
    baseStyles.borderBottomWidth = 0;
    if (element.indexOfType !== 0) {
      baseStyles.borderLeftWidth = tableStyles.borderWidth;
      baseStyles.borderTopWidth = tableStyles.borderWidth;
    }
  }

  const colCount = getMaxColumns(table);
  const basePercent = 100 / colCount;
  baseStyles.width = basePercent.toFixed(5) + '%';

  if (element.attributes && element.attributes.colspan) {
    const colspan = parseInt(element.attributes.colspan, 10);
    if (!isNaN(colspan)) {
      baseStyles.width = (colspan * basePercent).toFixed(5) + '%';
    }
  }

  return <View style={{ ...baseStyles, ...style }}>{children}</View>;
};

const renderers: HtmlRenderers = {
  style: renderNoop,
  script: renderNoop,
  html: renderPassThrough,
  li: ({ element, stylesheets, style, children }) => {
    const bulletStyles = stylesheets.map((stylesheet) => stylesheet.li_bullet);
    const contentStyles = stylesheets.map(
      (stylesheet) => stylesheet.li_content
    );
    const list: HtmlElement = element.closest('ol, ul') as HtmlElement;
    const ordered = list?.tag === 'ol' || element.parentNode.tag === 'ol';
    const listStyle =
      list?.style?.reduce(
        (combined, listStyle) => Object.assign(combined, listStyle),
        {} as HtmlStyle
      ) || {};
    const itemStyle = element.style.reduce(
      (combined, itemStyle) => Object.assign(combined, itemStyle),
      {} as HtmlStyle
    );
    const listStyleType =
      itemStyle.listStyleType ||
      itemStyle.listStyle ||
      listStyle.listStyleType ||
      listStyle.listStyle ||
      '';

    let bullet;
    if (listStyleType.includes('none')) {
      bullet = false;
    } else if (listStyleType.includes('url(')) {
      bullet = (
        <Image
          src={listStyleType.match(/\((.*?)\)/)[1].replace(/(['"])/g, '')}
        />
      );
    } else if (ordered) {
      const currentIndex = element.indexOfType;
      const start = parseInt(element.parentNode.attributes.start, 10);
      const offset = isNaN(start) ? 0 : start - 1; // keep it zero based for later

      let updatedIndex = currentIndex + offset;
      let currentElement: HtmlElement | null = element;
      let sibling: HtmlElement | null = currentElement;
      do {
        currentElement = sibling;
        sibling = currentElement.previousElementSibling as HtmlElement | null;

        if (!currentElement) {
          break;
        }
        if (currentElement.tag !== 'li') {
          // skip all other element types because they do not belong in a list
          continue;
        }
        const startValue = parseInt(currentElement.attributes.value, 10);

        if (!isNaN(startValue)) {
          updatedIndex =
            startValue + (currentIndex - currentElement.indexOfType) - 1;
          break;
        }
      } while (!!sibling);

      if (lowerAlpha.includes(listStyleType)) {
        bullet = <Text>{orderedAlpha[updatedIndex].toLowerCase()}.</Text>;
      } else if (upperAlpha.includes(listStyleType)) {
        bullet = <Text>{orderedAlpha[updatedIndex].toUpperCase()}.</Text>;
      } else if (listStyleType == 'lower-roman') {
        bullet = <Text>{toRoman(element.indexOfType + 1).toLowerCase()}.</Text>;
      } else if (listStyleType == 'upper-roman') {
        bullet = <Text>{toRoman(element.indexOfType + 1).toUpperCase()}.</Text>;
      } else {
        bullet = <Text>{updatedIndex + 1}.</Text>;
      }
    } else {
      // if (listStyleType.includes('square')) {
      //   bullet = <Text>■</Text>;
      // } else {
      bullet = <Text>•</Text>;
      // }
    }

    return (
      <View style={style}>
        {bullet && <View style={bulletStyles}>{bullet}</View>}
        <View style={contentStyles}>{children}</View>
      </View>
    );
  },
  a: ({ style, element, children }) => (
    <Link style={style} src={element.attributes.href}>
      {children}
    </Link>
  ),
  img: ({ style, element }) => (
    <Image
      style={style}
      source={{
        uri: element.attributes.src,
        body: null,
        method: 'GET',
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }}
    />
  ),
  table: ({ element, style, children }) => {
    const tableStyles = element.style.reduce(
      (combined, tableStyle) => Object.assign(combined, tableStyle),
      {} as HtmlStyle
    );
    const overrides: HtmlStyle = {};
    if (
      !(tableStyles as any).borderSpacing ||
      (tableStyles as any).borderCollapse === 'collapse'
    ) {
      overrides.borderLeftWidth = 0;
      overrides.borderTopWidth = 0;
    }

    return <View style={{ ...style, ...overrides }}>{children}</View>;
  },
  tr: ({ style, children }) => (
    <View wrap={false} style={style}>
      {children}
    </View>
  ),
  br: ({ style }) => (
    <Text wrap={false} style={style}>
      {'\n'}
    </Text>
  ),
  td: renderCell,
  th: renderCell,
  svg: renderSvgs.bind(null, Svg),
  line: renderSvgs.bind(null, Line),
  polyline: renderSvgs.bind(null, Polyline),
  polygon: renderSvgs.bind(null, Polygon),
  path: renderSvgs.bind(null, Path),
  rect: renderSvgs.bind(null, Rect),
  circle: renderSvgs.bind(null, Circle),
  ellipse: renderSvgs.bind(null, Ellipse),
  text: renderSvgs.bind(null, Text),
  tspan: renderSvgs.bind(null, Tspan),
  g: renderSvgs.bind(null, G),
  stop: renderSvgs.bind(null, Stop),
  defs: renderSvgs.bind(null, Defs),
  clippath: renderSvgs.bind(null, ClipPath),
  lineargradient: renderSvgs.bind(null, LinearGradient),
  radialgradient: renderSvgs.bind(null, RadialGradient),
};

export default renderers;
