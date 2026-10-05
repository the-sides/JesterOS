# JesterOS

JesterOS simulates operating-system desktops and applications for actors to use as film and television screen props.

## Language

**OS profile**:
A specific operating-system family, release/era, and optional hardware or regional configuration reproduced by JesterOS. Mojave 10.14 and Windows 11 are different profiles, not alternate color themes.
_Avoid_: Skin, theme when referring to an entire OS

**Profile capability**:
A simulated behavior or surface currently available in an OS profile. Native features not yet reproduced by JesterOS are outside that profile's capabilities.

**Puppet screen**:
The actor-facing simulated desktop and its applications. It depicts the selected OS profile rather than operating the host computer.

**Controller**:
The separate operator-facing interface used to direct puppet screens. It is not an application inside the simulated desktop.

**Scene**:
The fictional environment shown on a puppet screen, including its OS profile, accounts, files, conversations, devices, and time.

**Take**:
An individual run of a scene during which actor actions and operator cues change the simulated state.

**Operator cue**:
An instruction to make a particular change or presentation occur on a puppet screen, such as receiving a message, opening a dialog, or showing a low battery.

**Simulated application**:
A program depicted inside a scene, with its own fictional records and running state. It can remain running without an open window when the selected OS profile uses that lifecycle.
_Avoid_: Host process

**Managed window**:
An individually movable, resizable and closable scene surface belonging to a simulated application. Closing one window is not the same action as quitting its application.
_Avoid_: App when referring to one of its windows

**Application quit**:
The scene action that closes an application's windows and ends its running state, subject to any unsaved-document confirmation. It never terminates a host program.

**Active application**:
The simulated application supplying the foreground menus and application shortcuts. In a macOS scene it can remain active and running after its last window closes.
