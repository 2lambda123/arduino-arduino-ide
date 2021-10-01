import * as React from 'react';
import { postConstruct, injectable, inject } from 'inversify';
import { OptionsType } from 'react-select/src/types';
import { isOSX } from '@theia/core/lib/common/os';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { Key, KeyCode } from '@theia/core/lib/browser/keys';
import {
  DisposableCollection,
  Disposable,
} from '@theia/core/lib/common/disposable';
import {
  ReactWidget,
  Message,
  Widget,
  MessageLoop,
} from '@theia/core/lib/browser/widgets';
import { Board, Port } from '../../common/protocol/boards-service';
import { MonitorConfig } from '../../common/protocol/monitor-service';
import { ArduinoSelect } from '../widgets/arduino-select';
import { MonitorModel } from './monitor-model';
import { MonitorConnection } from './monitor-connection';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import dateFormat = require('dateformat');

@injectable()
export class MonitorWidget extends ReactWidget {
  static readonly ID = 'serial-monitor';

  @inject(MonitorModel)
  protected readonly monitorModel: MonitorModel;

  @inject(MonitorConnection)
  protected readonly monitorConnection: MonitorConnection;

  protected widgetHeight: number;

  /**
   * Do not touch or use it. It is for setting the focus on the `input` after the widget activation.
   */
  protected focusNode: HTMLElement | undefined;
  /**
   * Guard against re-rendering the view after the close was requested.
   * See: https://github.com/eclipse-theia/theia/issues/6704
   */
  protected closing = false;
  protected readonly clearOutputEmitter = new Emitter<void>();

  constructor() {
    super();
    this.id = MonitorWidget.ID;
    this.title.label = 'Serial Monitor';
    this.title.iconClass = 'monitor-tab-icon';
    this.title.closable = true;
    this.scrollOptions = undefined;
    this.toDispose.push(this.clearOutputEmitter);
    this.toDispose.push(
      Disposable.create(() => {
        this.monitorConnection.autoConnect = false;
        if (this.monitorConnection.connected) {
          this.monitorConnection.disconnect();
        }
      })
    );
  }

  @postConstruct()
  protected init(): void {
    this.update();
    this.toDispose.push(
      this.monitorConnection.onConnectionChanged(() => this.clearConsole())
    );
  }

  clearConsole(): void {
    this.clearOutputEmitter.fire(undefined);
    this.update();
  }

  dispose(): void {
    super.dispose();
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.monitorConnection.autoConnect = true;
  }

  onCloseRequest(msg: Message): void {
    this.closing = true;
    super.onCloseRequest(msg);
  }

  protected onUpdateRequest(msg: Message): void {
    // TODO: `this.isAttached`
    // See: https://github.com/eclipse-theia/theia/issues/6704#issuecomment-562574713
    if (!this.closing && this.isAttached) {
      super.onUpdateRequest(msg);
    }
  }

  protected onResize(msg: Widget.ResizeMessage): void {
    super.onResize(msg);
    this.widgetHeight = msg.height;
    this.update();
  }

  protected onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    (this.focusNode || this.node).focus();
  }

  protected onFocusResolved = (element: HTMLElement | undefined) => {
    if (this.closing || !this.isAttached) {
      return;
    }
    this.focusNode = element;
    requestAnimationFrame(() =>
      MessageLoop.sendMessage(this, Widget.Msg.ActivateRequest)
    );
  };

  protected get lineEndings(): OptionsType<SelectOption<MonitorModel.EOL>> {
    return [
      {
        label: 'No Line Ending',
        value: '',
      },
      {
        label: 'New Line',
        value: '\n',
      },
      {
        label: 'Carriage Return',
        value: '\r',
      },
      {
        label: 'Both NL & CR',
        value: '\r\n',
      },
    ];
  }

  protected get baudRates(): OptionsType<SelectOption<MonitorConfig.BaudRate>> {
    const baudRates: Array<MonitorConfig.BaudRate> = [
      300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
    ];
    return baudRates.map((baudRate) => ({
      label: baudRate + ' baud',
      value: baudRate,
    }));
  }

  protected render(): React.ReactNode {
    const { baudRates, lineEndings } = this;
    const lineEnding =
      lineEndings.find((item) => item.value === this.monitorModel.lineEnding) ||
      lineEndings[1]; // Defaults to `\n`.
    const baudRate =
      baudRates.find((item) => item.value === this.monitorModel.baudRate) ||
      baudRates[4]; // Defaults to `9600`.
    return (
      <div className="serial-monitor">
        <div className="head">
          <div className="send">
            <SerialMonitorSendInput
              monitorConfig={this.monitorConnection.monitorConfig}
              resolveFocus={this.onFocusResolved}
              onSend={this.onSend}
            />
          </div>
          <div className="config">
            <div className="select">
              <ArduinoSelect
                maxMenuHeight={this.widgetHeight - 40}
                options={lineEndings}
                defaultValue={lineEnding}
                onChange={this.onChangeLineEnding}
              />
            </div>
            <div className="select">
              <ArduinoSelect
                className="select"
                maxMenuHeight={this.widgetHeight - 40}
                options={baudRates}
                defaultValue={baudRate}
                onChange={this.onChangeBaudRate}
              />
            </div>
          </div>
        </div>
        <div className="body">
          <SerialMonitorOutput
            monitorModel={this.monitorModel}
            monitorConnection={this.monitorConnection}
            clearConsoleEvent={this.clearOutputEmitter.event}
          />
        </div>
      </div>
    );
  }

  protected readonly onSend = (value: string) => this.doSend(value);
  protected async doSend(value: string): Promise<void> {
    this.monitorConnection.send(value);
  }

  protected readonly onChangeLineEnding = (
    option: SelectOption<MonitorModel.EOL>
  ) => {
    this.monitorModel.lineEnding = option.value;
  };

  protected readonly onChangeBaudRate = (
    option: SelectOption<MonitorConfig.BaudRate>
  ) => {
    this.monitorModel.baudRate = option.value;
  };
}

export namespace SerialMonitorSendInput {
  export interface Props {
    readonly monitorConfig?: MonitorConfig;
    readonly onSend: (text: string) => void;
    readonly resolveFocus: (element: HTMLElement | undefined) => void;
  }
  export interface State {
    text: string;
  }
}

export class SerialMonitorSendInput extends React.Component<
  SerialMonitorSendInput.Props,
  SerialMonitorSendInput.State
> {
  constructor(props: Readonly<SerialMonitorSendInput.Props>) {
    super(props);
    this.state = { text: '' };
    this.onChange = this.onChange.bind(this);
    this.onSend = this.onSend.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  render(): React.ReactNode {
    return (
      <input
        ref={this.setRef}
        type="text"
        className={`theia-input ${this.props.monitorConfig ? '' : 'warning'}`}
        placeholder={this.placeholder}
        value={this.state.text}
        onChange={this.onChange}
        onKeyDown={this.onKeyDown}
      />
    );
  }

  protected get placeholder(): string {
    const { monitorConfig } = this.props;
    if (!monitorConfig) {
      return 'Not connected. Select a board and a port to connect automatically.';
    }
    const { board, port } = monitorConfig;
    return `Message (${
      isOSX ? '⌘' : 'Ctrl'
    }+Enter to send message to '${Board.toString(board, {
      useFqbn: false,
    })}' on '${Port.toString(port)}')`;
  }

  protected setRef = (element: HTMLElement | null) => {
    if (this.props.resolveFocus) {
      this.props.resolveFocus(element || undefined);
    }
  };

  protected onChange(event: React.ChangeEvent<HTMLInputElement>): void {
    this.setState({ text: event.target.value });
  }

  protected onSend(): void {
    this.props.onSend(this.state.text);
    this.setState({ text: '' });
  }

  protected onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const keyCode = KeyCode.createKeyCode(event.nativeEvent);
    if (keyCode) {
      const { key, meta, ctrl } = keyCode;
      if (key === Key.ENTER && ((isOSX && meta) || (!isOSX && ctrl))) {
        this.onSend();
      }
    }
  }
}

export type Line = { message: string; timestamp?: Date };

export class SerialMonitorOutput extends React.Component<
  SerialMonitorOutput.Props,
  SerialMonitorOutput.State
> {
  /**
   * Do not touch it. It is used to be able to "follow" the serial monitor log.
   */
  protected anchor: HTMLElement | null;
  protected toDisposeBeforeUnmount = new DisposableCollection();

  constructor(props: Readonly<SerialMonitorOutput.Props>) {
    super(props);
    this.state = {
      lines: [],
      timestamp: this.props.monitorModel.timestamp,
      charCount: 0,
    };
  }

  render(): React.ReactNode {
    return (
      <React.Fragment>
        <AutoSizer>
          {({ height, width }) => (
            <List
              className="List"
              height={height}
              itemData={
                {
                  lines: this.state.lines,
                  timestamp: this.state.timestamp,
                } as any
              }
              itemCount={this.state.lines.length}
              itemSize={20}
              width={width}
            >
              {Row}
            </List>
          )}
        </AutoSizer>
        {/* <div style={{ whiteSpace: 'pre', fontFamily: 'monospace' }}>
          {this.state.lines.map((line, i) => (
            <MonitorTextLine text={line} key={i} />
          ))}
        </div> */}
        <div
          style={{ float: 'left', clear: 'both' }}
          ref={(element) => {
            this.anchor = element;
          }}
        />
      </React.Fragment>
    );
  }

  shouldComponentUpdate(): boolean {
    return true;
  }

  componentDidMount(): void {
    this.scrollToBottom();
    this.toDisposeBeforeUnmount.pushAll([
      this.props.monitorConnection.onRead(({ messages }) => {
        const [newLines, charsToAddCount] = messageToLines(
          messages,
          this.state.lines
        );
        const [lines, charCount] = truncateLines(
          newLines,
          this.state.charCount + charsToAddCount
        );

        this.setState({
          lines,
          charCount,
        });
      }),
      this.props.clearConsoleEvent(() => this.setState({ lines: [] })),
      this.props.monitorModel.onChange(({ property }) => {
        if (property === 'timestamp') {
          const { timestamp } = this.props.monitorModel;
          this.setState({ timestamp });
        }
      }),
    ]);
  }

  componentDidUpdate(): void {
    this.scrollToBottom();
  }

  componentWillUnmount(): void {
    // TODO: "Your preferred browser's local storage is almost full." Discard `content` before saving layout?
    this.toDisposeBeforeUnmount.dispose();
  }

  protected scrollToBottom(): void {
    if (this.props.monitorModel.autoscroll && this.anchor) {
      this.anchor.scrollIntoView();
      // this.listRef.current.scrollToItem(this.state.lines.length);
    }
  }
}

const Row = ({
  index,
  style,
  data,
}: {
  index: number;
  style: any;
  data: { lines: Line[]; timestamp: boolean };
}) => {
  const timestamp =
    (data.timestamp &&
      `${dateFormat(data.lines[index].timestamp, 'H:M:ss.l')} -> `) ||
    '';
  return (
    <div style={style}>
      {timestamp}
      {data.lines[index].message}
    </div>
  );
};

export interface SelectOption<T> {
  readonly label: string;
  readonly value: T;
}

export namespace SerialMonitorOutput {
  export interface Props {
    readonly monitorModel: MonitorModel;
    readonly monitorConnection: MonitorConnection;
    readonly clearConsoleEvent: Event<void>;
  }

  export interface State {
    lines: Line[];
    timestamp: boolean;
    charCount: number;
  }

  export const MAX_CHARACTERS = 1_000_000;
}

function messageToLines(
  messages: string[],
  prevLines: Line[],
  separator = '\n'
): [Line[], number] {
  const linesToAdd: Line[] = prevLines.length
    ? [prevLines[prevLines.length - 1]]
    : [{ message: '' }];
  let charCount = 0;

  for (const message of messages) {
    charCount += message.length;
    const lastLine = linesToAdd[linesToAdd.length - 1];

    if (lastLine.message.charAt(lastLine.message.length - 1) === separator) {
      linesToAdd.push({ message, timestamp: new Date() });
    } else {
      linesToAdd[linesToAdd.length - 1].message += message;
      if (!linesToAdd[linesToAdd.length - 1].timestamp) {
        linesToAdd[linesToAdd.length - 1].timestamp = new Date();
      }
    }
  }

  prevLines.splice(prevLines.length - 1, 1, ...linesToAdd);
  return [prevLines, charCount];
}

function truncateLines(lines: Line[], charCount: number): [Line[], number] {
  let charsToDelete = charCount - SerialMonitorOutput.MAX_CHARACTERS;
  while (charsToDelete > 0) {
    const firstLineLength = lines[0]?.message?.length;
    const newFirstLine = lines[0]?.message?.substring(charsToDelete);
    const deletedCharsCount = firstLineLength - newFirstLine.length;
    charCount -= deletedCharsCount;
    charsToDelete -= deletedCharsCount;
    lines[0].message = newFirstLine;
    if (!newFirstLine?.length) {
      lines.shift();
    }
  }
  return [lines, charCount];
}
